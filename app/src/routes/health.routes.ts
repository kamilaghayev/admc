import { Router, type Request, type Response } from "express";
import type {
  MongoAdapter,
  PostgresAdapter,
  RedisAdapter,
} from "../adapters/index.js";

export type HealthDeps = {
  postgres: PostgresAdapter;
  mongo: MongoAdapter;
  redis: RedisAdapter;
  readStrategy: string;
};

export function buildHealthRouter(deps: HealthDeps): Router {
  const router = Router();

  router.get("/", async (_req: Request, res: Response) => {
    const [pOk, mOk, rOk] = await Promise.all([
      deps.postgres.ping(),
      deps.mongo.ping(),
      deps.redis.ping(),
    ]);
    res.json({
      status: "ok",
      databases: { postgres: pOk, mongodb: mOk, redis: rOk },
      readStrategy: deps.readStrategy,
    });
  });

  return router;
}

export const openApiTags = [
  { name: "Health", description: "Sağlamlıq yoxlaması" },
];

export const openApiPaths = {
  "/health": {
    get: {
      tags: ["Health"],
      summary: "Health check (DB adapter ping)",
      responses: {
        "200": {
          description: "OK",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  status: { type: "string", example: "ok" },
                  databases: {
                    type: "object",
                    properties: {
                      postgres: { type: "boolean" },
                      mongodb: { type: "boolean" },
                      redis: { type: "boolean" },
                    },
                  },
                  readStrategy: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  },
};
