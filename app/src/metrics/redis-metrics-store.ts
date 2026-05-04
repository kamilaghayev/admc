import { createClient } from "redis";

export type RedisMetricsClient = ReturnType<typeof createClient>;
import { aggregateHttpSummary, aggregateRepoSummary } from "./aggregate.js";
import type {
  HttpMetricRecord,
  HttpPathSummary,
  MetricRecord,
  OpSummary,
  RepoOp,
} from "./repository-metrics.js";

const KEY_REPO = "diss:metrics:repo";
const KEY_HTTP = "diss:metrics:http";

export class RedisMetricsStore {
  constructor(
    private readonly client: RedisMetricsClient,
    private readonly maxEntries: number,
  ) {}

  async appendRepo(r: MetricRecord): Promise<void> {
    const payload = JSON.stringify(r);
    await this.client.lPush(KEY_REPO, payload);
    await this.client.lTrim(KEY_REPO, 0, this.maxEntries - 1);
  }

  async appendHttp(h: HttpMetricRecord): Promise<void> {
    const payload = JSON.stringify(h);
    await this.client.lPush(KEY_HTTP, payload);
    await this.client.lTrim(KEY_HTTP, 0, this.maxEntries - 1);
  }

  async loadAllRepo(): Promise<MetricRecord[]> {
    const raw = await this.client.lRange(KEY_REPO, 0, this.maxEntries - 1);
    return raw.map((s) => JSON.parse(s) as MetricRecord);
  }

  async loadAllHttp(): Promise<HttpMetricRecord[]> {
    const raw = await this.client.lRange(KEY_HTTP, 0, this.maxEntries - 1);
    return raw.map((s) => JSON.parse(s) as HttpMetricRecord);
  }

  async getRecentRepo(limit: number): Promise<MetricRecord[]> {
    const n = Math.max(1, limit);
    const raw = await this.client.lRange(KEY_REPO, 0, n - 1);
    return raw.map((s) => JSON.parse(s) as MetricRecord);
  }

  async getRecentHttp(limit: number): Promise<HttpMetricRecord[]> {
    const n = Math.max(1, limit);
    const raw = await this.client.lRange(KEY_HTTP, 0, n - 1);
    return raw.map((s) => JSON.parse(s) as HttpMetricRecord);
  }

  async getRecentForOp(op: RepoOp, sampleSize: number): Promise<MetricRecord[]> {
    const raw = await this.client.lRange(KEY_REPO, 0, this.maxEntries - 1);
    const out: MetricRecord[] = [];
    for (const s of raw) {
      const r = JSON.parse(s) as MetricRecord;
      if (r.op === op) {
        out.push(r);
        if (out.length >= sampleSize) break;
      }
    }
    return out;
  }

  async computeRepoSummary(): Promise<OpSummary[]> {
    const all = await this.loadAllRepo();
    return aggregateRepoSummary(all);
  }

  async computeHttpSummary(): Promise<HttpPathSummary[]> {
    const all = await this.loadAllHttp();
    return aggregateHttpSummary(all);
  }
}
