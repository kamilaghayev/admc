import path from "node:path";
import type { DbName } from "../metrics/repository-metrics.js";
import type { ReadStrategy } from "../repositories/types.js";

export type AppEnv = {
  port: number;
  publicUrl: string;
  databaseUrl: string;
  mongoUri: string;
  redisUrl: string;
  readStrategy: ReadStrategy;
  metricsBufferSize: number;
  decisionDefaultDb: DbName;
  decisionSampleSize: number;
  decisionMinSamples: number;
  corsOrigins: string[];
  metricsPersistRedis: boolean;
  metricsQueryFromRedis: boolean;
  metricsRedisMaxEntries: number;
  jwtSecret: string;
  jwtAccessTtlSec: number;
  jwtRefreshTtlSec: number;
  adminUsername: string;
  adminPassword: string;
  /** k6 yüklənən endpoint (eyni konteynerdə API → 127.0.0.1:PORT) */
  loadTestBaseUrl: string;
  loadTestMaxDurationMs: number;
  k6BinaryPath: string;
  loadtestsDirOverride: string | null;
  loadTestAccuracyThreshold: number;
  /** Yük testləri üçün JSON tarixçənin saxlanması */
  loadTestResultsDir: string;
};

const DEFAULT_CORS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
];

function parseStrategy(value: string | undefined): ReadStrategy {
  if (
    value === "postgres" ||
    value === "mongo" ||
    value === "decision" ||
    value === "race"
  ) {
    return value;
  }
  return "race";
}

function parseDb(value: string | undefined, fallback: DbName): DbName {
  return value === "postgres" || value === "mongo" ? value : fallback;
}

function parsePositive(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseCorsOrigins(value: string | undefined): string[] {
  if (!value?.trim()) return [...DEFAULT_CORS];
  const parsed = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : [...DEFAULT_CORS];
}

function parseBool(value: string | undefined, defaultTrue: boolean): boolean {
  if (value === undefined || value === "") return defaultTrue;
  const v = value.toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return defaultTrue;
}

export function loadEnv(): AppEnv {
  const port = Number(process.env.PORT) || 3000;
  const publicUrl =
    process.env.PUBLIC_URL?.replace(/\/$/, "") ?? `http://localhost:${port}`;

  const metricsPersistRedis = parseBool(
    process.env.METRICS_USE_REDIS,
    true,
  );
  const metricsQueryFromRedisEnv = parseBool(
    process.env.METRICS_QUERY_FROM_REDIS,
    true,
  );

  const isProduction = process.env.NODE_ENV === "production";

  const jwtSecretEnv = process.env.JWT_SECRET?.trim();
  let jwtSecret: string;
  if (jwtSecretEnv && jwtSecretEnv.length > 0) {
    jwtSecret = jwtSecretEnv;
  } else if (isProduction) {
    throw new Error(
      "[env] JWT_SECRET is required in production (min 32 characters).",
    );
  } else {
    jwtSecret =
      "dev-insecure-secret-" + Math.random().toString(36).slice(2, 12);
    console.warn(
      "[env] JWT_SECRET not set, using ephemeral dev secret. Tokens will not survive restarts.",
    );
  }

  if (isProduction && jwtSecret.length < 32) {
    throw new Error(
      "[env] JWT_SECRET must be at least 32 characters in production.",
    );
  }

  const adminPassword = process.env.ADMIN_PASSWORD?.trim() || "admin";
  if (!process.env.ADMIN_PASSWORD?.trim()) {
    if (isProduction) {
      throw new Error("[env] ADMIN_PASSWORD is required in production.");
    }
    console.warn(
      "[env] ADMIN_PASSWORD not set, defaulting to 'admin'. Override in production!",
    );
  }

  return {
    port,
    publicUrl,
    databaseUrl:
      process.env.DATABASE_URL ?? "postgres://diss:diss@localhost:5432/diss",
    mongoUri: process.env.MONGODB_URI ?? "mongodb://localhost:27017/diss",
    redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
    readStrategy: parseStrategy(process.env.READ_STRATEGY),
    metricsBufferSize: parsePositive(process.env.METRICS_BUFFER_SIZE, 500),
    decisionDefaultDb: parseDb(process.env.DECISION_DEFAULT_DB, "postgres"),
    decisionSampleSize: parsePositive(process.env.DECISION_SAMPLE_SIZE, 50),
    decisionMinSamples: parsePositive(process.env.DECISION_MIN_SAMPLES, 3),
    corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS),
    metricsPersistRedis,
    metricsQueryFromRedis:
      metricsPersistRedis && metricsQueryFromRedisEnv,
    metricsRedisMaxEntries: parsePositive(
      process.env.METRICS_REDIS_MAX_ENTRIES,
      5000,
    ),
    jwtSecret,
    jwtAccessTtlSec: parsePositive(process.env.JWT_ACCESS_TTL_SEC, 900),
    jwtRefreshTtlSec: parsePositive(process.env.JWT_REFRESH_TTL_SEC, 604800),
    adminUsername: (process.env.ADMIN_USERNAME?.trim() || "admin"),
    adminPassword,
    loadTestBaseUrl:
      process.env.LOAD_TEST_BASE_URL?.trim() ||
      `http://127.0.0.1:${port}`,
    loadTestMaxDurationMs: parsePositive(
      process.env.LOAD_TEST_MAX_MS,
      660_000,
    ),
    k6BinaryPath: process.env.K6_BINARY?.trim() || "k6",
    loadtestsDirOverride:
      ((): string | null => {
        const d = process.env.LOADTESTS_DIR?.trim();
        return d && d.length > 0 ? d : null;
      })(),
    loadTestAccuracyThreshold: parsePositive(
      process.env.ACCURACY_THRESHOLD,
      60,
    ),
    loadTestResultsDir: path.resolve(
      process.env.LOAD_TEST_RESULTS_DIR?.trim() ||
        path.join(process.cwd(), "data", "load-test-results"),
    ),
  };
}
