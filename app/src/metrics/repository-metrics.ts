import { aggregateHttpSummary, aggregateRepoSummary } from "./aggregate.js";
import { getRequestMetricsCtx } from "./request-context.js";
import type { RedisMetricsStore } from "./redis-metrics-store.js";

export type RepoOp =
  | "create"
  | "findById"
  | "findAll"
  | "findByUsername"
  | "update"
  | "delete";

export type DbName = "postgres" | "mongo";

export type MetricRecord = {
  op: RepoOp;
  timestamp: number;
  postgresMs: number | null;
  mongoMs: number | null;
  postgresOk: boolean;
  mongoOk: boolean;
  selectedDb: DbName | null;
  partialFailure: boolean;
  requestId?: string;
  error?: string;
};

export type HttpMetricRecord = {
  requestId: string;
  method: string;
  path: string;
  status: number;
  totalMs: number;
  pgMsTotal: number;
  mongoMsTotal: number;
  opCount: number;
  selectedCounts: { postgres: number; mongo: number; none: number };
  partialFailures: number;
  timestamp: number;
};

export type OpSummary = {
  op: RepoOp;
  count: number;
  avgPostgresMs: number | null;
  avgMongoMs: number | null;
  postgresWins: number;
  mongoWins: number;
  postgresFailures: number;
  mongoFailures: number;
};

export type HttpPathSummary = {
  path: string;
  method: string;
  count: number;
  avgTotalMs: number | null;
  avgPostgresMs: number | null;
  avgMongoMs: number | null;
  avgOpCount: number | null;
};

export type RealtimeCallbacks = {
  onRepoMetric?(r: MetricRecord): void;
  onHttpMetric?(h: HttpMetricRecord): void;
};

export type MetricsRecorderOptions = {
  redisStore?: RedisMetricsStore | null;
  /** true: summary/recent/decision Redis-dən (persist + restart sonrası davam) */
  readFromRedis: boolean;
  realtime?: RealtimeCallbacks | null;
};

export class MetricsRecorder {
  private readonly buffer: MetricRecord[] = [];
  private readonly httpBuffer: HttpMetricRecord[] = [];

  constructor(
    private readonly capacity = 500,
    private readonly options: MetricsRecorderOptions = {
      readFromRedis: false,
    },
  ) {}

  record(record: MetricRecord): void {
    const ctx = getRequestMetricsCtx();
    if (ctx) {
      const enriched: MetricRecord = { ...record, requestId: ctx.requestId };
      this.pushRepo(enriched);
      ctx.opCount += 1;
      if (record.postgresMs !== null) ctx.pgMsTotal += record.postgresMs;
      if (record.mongoMs !== null) ctx.mongoMsTotal += record.mongoMs;
      if (record.partialFailure) ctx.partialFailures += 1;
      if (record.selectedDb === "postgres") ctx.selectedCounts.postgres += 1;
      else if (record.selectedDb === "mongo") ctx.selectedCounts.mongo += 1;
      else ctx.selectedCounts.none += 1;
      ctx.lastSelected = record.selectedDb;
      this.persistRepo(enriched);
      this.options.realtime?.onRepoMetric?.(enriched);
    } else {
      this.pushRepo(record);
      this.persistRepo(record);
      this.options.realtime?.onRepoMetric?.(record);
    }
  }

  recordHttp(record: HttpMetricRecord): void {
    this.httpBuffer.push(record);
    if (this.httpBuffer.length > this.capacity) {
      this.httpBuffer.splice(0, this.httpBuffer.length - this.capacity);
    }
    void this.options.redisStore?.appendHttp(record).catch((err) => {
      console.error("[metrics-redis] appendHttp failed:", err);
    });
    this.options.realtime?.onHttpMetric?.(record);
  }

  async summary(): Promise<OpSummary[]> {
    if (this.options.readFromRedis && this.options.redisStore) {
      const fromRedis = await this.options.redisStore.computeRepoSummary();
      const anyCount = fromRedis.some((s) => s.count > 0);
      if (anyCount) return fromRedis;
    }
    return aggregateRepoSummary([...this.buffer]);
  }

  async recent(limit = 100): Promise<MetricRecord[]> {
    const n = Math.min(Math.max(limit, 1), this.capacity);
    if (this.options.readFromRedis && this.options.redisStore) {
      const rows = await this.options.redisStore.getRecentRepo(n);
      if (rows.length > 0) return rows;
    }
    return this.buffer.slice(-n).reverse();
  }

  async recentHttp(limit = 100): Promise<HttpMetricRecord[]> {
    const n = Math.min(Math.max(limit, 1), this.capacity);
    if (this.options.readFromRedis && this.options.redisStore) {
      const rows = await this.options.redisStore.getRecentHttp(n);
      if (rows.length > 0) return rows;
    }
    return this.httpBuffer.slice(-n).reverse();
  }

  async recentForOp(op: RepoOp, sampleSize: number): Promise<MetricRecord[]> {
    if (this.options.readFromRedis && this.options.redisStore) {
      return this.options.redisStore.getRecentForOp(op, sampleSize);
    }
    const out: MetricRecord[] = [];
    for (let i = this.buffer.length - 1; i >= 0 && out.length < sampleSize; i--) {
      const r = this.buffer[i]!;
      if (r.op === op) out.push(r);
    }
    return out;
  }

  async summaryHttp(): Promise<HttpPathSummary[]> {
    if (this.options.readFromRedis && this.options.redisStore) {
      const fromRedis = await this.options.redisStore.computeHttpSummary();
      if (fromRedis.length > 0) return fromRedis;
    }
    return aggregateHttpSummary([...this.httpBuffer]);
  }

  getSource(): "redis" | "memory" {
    return this.options.readFromRedis && this.options.redisStore
      ? "redis"
      : "memory";
  }

  private pushRepo(record: MetricRecord): void {
    this.buffer.push(record);
    if (this.buffer.length > this.capacity) {
      this.buffer.splice(0, this.buffer.length - this.capacity);
    }
  }

  private persistRepo(record: MetricRecord): void {
    if (!this.options.redisStore) return;
    void this.options.redisStore.appendRepo(record).catch((err) => {
      console.error("[metrics-redis] appendRepo failed:", err);
    });
  }
}
