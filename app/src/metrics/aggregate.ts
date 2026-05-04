import type {
  HttpMetricRecord,
  HttpPathSummary,
  MetricRecord,
  OpSummary,
  RepoOp,
} from "./repository-metrics.js";

export const OPS: RepoOp[] = [
  "create",
  "findById",
  "findAll",
  "findByUsername",
  "update",
  "delete",
];

export function aggregateRepoSummary(records: MetricRecord[]): OpSummary[] {
  return OPS.map((op) => summaryForOp(op, records));
}

function summaryForOp(op: RepoOp, all: MetricRecord[]): OpSummary {
  const items = all.filter((r) => r.op === op);
  const pgTimes = items
    .map((r) => r.postgresMs)
    .filter((v): v is number => v !== null);
  const mgTimes = items
    .map((r) => r.mongoMs)
    .filter((v): v is number => v !== null);
  return {
    op,
    count: items.length,
    avgPostgresMs: avg(pgTimes),
    avgMongoMs: avg(mgTimes),
    postgresWins: items.filter((r) => r.selectedDb === "postgres").length,
    mongoWins: items.filter((r) => r.selectedDb === "mongo").length,
    postgresFailures: items.filter((r) => !r.postgresOk).length,
    mongoFailures: items.filter((r) => !r.mongoOk).length,
  };
}

export function aggregateHttpSummary(records: HttpMetricRecord[]): HttpPathSummary[] {
  const groups = new Map<string, HttpMetricRecord[]>();
  for (const r of records) {
    const key = `${r.method} ${r.path}`;
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }
  const out: HttpPathSummary[] = [];
  for (const [key, items] of groups) {
    const [method, path] = key.split(" ", 2) as [string, string];
    out.push({
      method,
      path,
      count: items.length,
      avgTotalMs: avg(items.map((r) => r.totalMs)),
      avgPostgresMs: avg(items.map((r) => r.pgMsTotal)),
      avgMongoMs: avg(items.map((r) => r.mongoMsTotal)),
      avgOpCount: avg(items.map((r) => r.opCount)),
    });
  }
  return out;
}

function avg(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const sum = xs.reduce((a, b) => a + b, 0);
  return Math.round((sum / xs.length) * 1000) / 1000;
}
