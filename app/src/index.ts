import http from "node:http";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import swaggerUi from "swagger-ui-express";
import {
  createMongoAdapter,
  createPostgresAdapter,
  createRedisAdapter,
  type MongoAdapter,
  type PostgresAdapter,
  type RedisAdapter,
} from "./adapters/index.js";
import { loadEnv } from "./config/env.js";
import { MetricsRecorder } from "./metrics/repository-metrics.js";
import { requestMetricsMiddleware } from "./metrics/request-metrics.middleware.js";
import { RedisMetricsStore } from "./metrics/redis-metrics-store.js";
import { MongoPostRepository } from "./repositories/base/mongo-post.repository.js";
import { MongoUserRepository } from "./repositories/base/mongo-user.repository.js";
import { PostgresPostRepository } from "./repositories/base/postgres-post.repository.js";
import { PostgresUserRepository } from "./repositories/base/postgres-user.repository.js";
import { DecisionEngine } from "./repositories/decision-engine.js";
import { SmartPostRepository } from "./repositories/post.repository.js";
import { SmartUserRepository } from "./repositories/user.repository.js";
import { attachMetricsSocket } from "./realtime/metrics-socket.js";
import { AuthService } from "./auth/auth.service.js";
import { JwtService } from "./auth/jwt.js";
import { requireAuth, requireRole } from "./auth/middleware.js";
import { RefreshTokenStore } from "./auth/refresh-store.js";
import { seedAdmin } from "./auth/seed.js";
import * as authRoute from "./routes/auth.routes.js";
import * as healthRoute from "./routes/health.routes.js";
import * as loadTestsRoute from "./routes/load-tests.routes.js";
import * as metricsRoute from "./routes/metrics.routes.js";
import * as postsRoute from "./routes/posts.routes.js";
import * as rootRoute from "./routes/root.routes.js";
import { PostService } from "./services/post.service.js";
import { UserService } from "./services/user.service.js";

async function main(): Promise<void> {
  const env = loadEnv();

  const [postgres, mongo, redis]: [
    PostgresAdapter,
    MongoAdapter,
    RedisAdapter,
  ] = await Promise.all([
    createPostgresAdapter(env.databaseUrl),
    createMongoAdapter(env.mongoUri),
    createRedisAdapter(env.redisUrl),
  ]);

  const pgPostRepo = new PostgresPostRepository(postgres.pool);
  const mongoPostRepo = new MongoPostRepository(mongo.db);
  const pgUserRepo = new PostgresUserRepository(postgres.pool);
  const mongoUserRepo = new MongoUserRepository(mongo.db);
  await Promise.all([
    pgPostRepo.init(),
    mongoPostRepo.init(),
    pgUserRepo.init(),
    mongoUserRepo.init(),
  ]);

  const redisMetricsStore =
    env.metricsPersistRedis
      ? new RedisMetricsStore(redis.client, env.metricsRedisMaxEntries)
      : null;

  const app = express();

  const httpServer = http.createServer(app);

  const metricsSocket = attachMetricsSocket(httpServer, env.corsOrigins);

  const metrics = new MetricsRecorder(env.metricsBufferSize, {
    redisStore: redisMetricsStore,
    readFromRedis: env.metricsQueryFromRedis && redisMetricsStore !== null,
    realtime: {
      onRepoMetric: (r) => metricsSocket.publishRepo(r),
      onHttpMetric: (h) => metricsSocket.publishHttp(h),
    },
  });

  const decision = new DecisionEngine(metrics, {
    defaultDb: env.decisionDefaultDb,
    sampleSize: env.decisionSampleSize,
    minSamples: env.decisionMinSamples,
  });
  const postRepo = new SmartPostRepository(
    pgPostRepo,
    mongoPostRepo,
    metrics,
    decision,
    { strategy: env.readStrategy },
  );
  const postService = new PostService(postRepo);

  const userRepo = new SmartUserRepository(
    pgUserRepo,
    mongoUserRepo,
    metrics,
    decision,
    { strategy: env.readStrategy },
  );
  const userService = new UserService(userRepo);

  const jwtService = new JwtService({
    secret: env.jwtSecret,
    accessTtlSec: env.jwtAccessTtlSec,
    refreshTtlSec: env.jwtRefreshTtlSec,
  });
  const refreshStore = new RefreshTokenStore(redis, env.jwtRefreshTtlSec);
  const authService = new AuthService(userService, jwtService, refreshStore);

  await seedAdmin(userService, {
    username: env.adminUsername,
    password: env.adminPassword,
  });

  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true,
      exposedHeaders: [
        "X-Request-Id",
        "X-Postgres-Ms",
        "X-Mongo-Ms",
        "X-Op-Count",
        "X-Selected-Db",
        "X-Partial-Failures",
      ],
    }),
  );
  app.use(express.json());
  app.use(requestMetricsMiddleware(metrics));

  const openApiDocument = {
    openapi: "3.0.3",
    info: {
      title: "Diss API",
      version: "1.0.0",
      description:
        "Multi-DB API: Redis-backed metrics, Socket.IO analytics, decision engine.",
    },
    servers: [{ url: env.publicUrl }],
    tags: [
      ...rootRoute.openApiTags,
      ...healthRoute.openApiTags,
      ...authRoute.openApiTags,
      ...postsRoute.openApiTags,
      ...metricsRoute.openApiTags,
      ...loadTestsRoute.openApiTags,
    ],
    components: {
      schemas: {
        ...postsRoute.openApiSchemas,
        ...authRoute.openApiSchemas,
      },
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
    paths: {
      ...rootRoute.openApiPaths,
      ...healthRoute.openApiPaths,
      ...authRoute.openApiPaths,
      ...postsRoute.openApiPaths,
      ...metricsRoute.openApiPaths,
      ...loadTestsRoute.openApiPaths,
    },
  };

  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));

  app.use("/", rootRoute.buildRootRouter({ publicUrl: env.publicUrl }));
  app.use(
    "/health",
    healthRoute.buildHealthRouter({
      postgres,
      mongo,
      redis,
      readStrategy: env.readStrategy,
    }),
  );
  app.use("/api/auth", authRoute.buildAuthRouter({ authService, jwt: jwtService }));
  app.use("/api/posts", postsRoute.buildPostsRouter(postService));
  app.use(
    "/api/metrics",
    requireAuth(jwtService),
    requireRole("admin"),
    metricsRoute.buildMetricsRouter({ metrics, decision }),
  );
  app.use(
    "/api/load-tests",
    requireAuth(jwtService),
    requireRole("admin"),
    loadTestsRoute.buildLoadTestsRouter({
      env,
      metrics,
      decision,
    }),
  );

  app.use(
    (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      console.error(err);
      const message = err instanceof Error ? err.message : "internal error";
      res.status(500).json({ error: message });
    },
  );

  httpServer.listen(env.port, () => {
    console.log(`API ${env.publicUrl}`);
    console.log(`Swagger ${env.publicUrl}/api-docs`);
    console.log(`Socket.IO path /socket.io (CORS: ${env.corsOrigins.join(", ")})`);
    console.log(`Read strategy: ${env.readStrategy}`);
    console.log(
      `Metrics: persistRedis=${env.metricsPersistRedis} queryFromRedis=${env.metricsQueryFromRedis} maxEntries=${env.metricsRedisMaxEntries}`,
    );
    console.log(
      `Decision: defaultDb=${env.decisionDefaultDb} sampleSize=${env.decisionSampleSize} minSamples=${env.decisionMinSamples}`,
    );
    console.log(
      `Load tests: BASE_URL=${env.loadTestBaseUrl} k6=${env.k6BinaryPath} timeoutMs=${env.loadTestMaxDurationMs}`,
    );
    console.log(`Load test JSON dir: ${env.loadTestResultsDir}`);
  });

  const closeAll = async (): Promise<void> => {
    metricsSocket.io.close();
    await Promise.all([postgres.close(), mongo.close(), redis.close()]);
  };

  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down...`);
    void (async () => {
      await closeAll();
      httpServer.close(() => process.exit(0));
    })();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
