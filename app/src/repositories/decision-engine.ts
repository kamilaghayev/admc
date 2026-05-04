import { OPS } from "../metrics/aggregate.js";
import type {
  DbName,
  MetricsRecorder,
  RepoOp,
} from "../metrics/repository-metrics.js";

export type DecisionEngineOptions = {
  defaultDb: DbName;
  sampleSize: number;
  minSamples: number;
};

export type DecisionReason = "default" | "stats" | "single-side-failure";

export type DecisionExplanation = {
  op: RepoOp;
  selected: DbName;
  reason: DecisionReason;
  pgAvgMs: number | null;
  mgAvgMs: number | null;
  pgSamples: number;
  mgSamples: number;
};

export type DecisionAccuracyOp = {
  op: RepoOp;
  selected: DbName;
  fasterDb: DbName | null;
  correct: boolean | null;
  pgAvgMs: number | null;
  mgAvgMs: number | null;
  samples: { pg: number; mg: number };
  reason: DecisionReason;
};

export type DecisionAccuracyReport = {
  perOp: DecisionAccuracyOp[];
  overall: {
    evaluated: number;
    correct: number;
    accuracyPct: number | null;
  };
};

export class DecisionEngine {
  constructor(
    private readonly metrics: MetricsRecorder,
    private readonly options: DecisionEngineOptions,
  ) {}

  async decide(op: RepoOp): Promise<DbName> {
    return (await this.explain(op)).selected;
  }

  async accuracy(): Promise<DecisionAccuracyReport> {
    const perOp = await Promise.all(
      OPS.map(async (op): Promise<DecisionAccuracyOp> => {
        const e = await this.explain(op);
        const hasBoth = e.pgSamples > 0 && e.mgSamples > 0;
        let fasterDb: DbName | null = null;
        let correct: boolean | null = null;
        if (hasBoth && e.pgAvgMs !== null && e.mgAvgMs !== null) {
          fasterDb = e.pgAvgMs <= e.mgAvgMs ? "postgres" : "mongo";
          correct = e.selected === fasterDb;
        }
        return {
          op,
          selected: e.selected,
          fasterDb,
          correct,
          pgAvgMs: e.pgAvgMs,
          mgAvgMs: e.mgAvgMs,
          samples: { pg: e.pgSamples, mg: e.mgSamples },
          reason: e.reason,
        };
      }),
    );
    const evaluated = perOp.filter((p) => p.correct !== null).length;
    const correct = perOp.filter((p) => p.correct === true).length;
    const accuracyPct =
      evaluated > 0
        ? Math.round((correct / evaluated) * 1000) / 10
        : null;
    return { perOp, overall: { evaluated, correct, accuracyPct } };
  }

  async explain(op: RepoOp): Promise<DecisionExplanation> {
    const recent = await this.metrics.recentForOp(
      op,
      this.options.sampleSize,
    );

    const pgTimes = recent
      .filter((r) => r.postgresOk)
      .map((r) => r.postgresMs)
      .filter((v): v is number => v !== null);
    const mgTimes = recent
      .filter((r) => r.mongoOk)
      .map((r) => r.mongoMs)
      .filter((v): v is number => v !== null);

    const total = recent.length;
    if (total < this.options.minSamples) {
      return {
        op,
        selected: this.options.defaultDb,
        reason: "default",
        pgAvgMs: avg(pgTimes),
        mgAvgMs: avg(mgTimes),
        pgSamples: pgTimes.length,
        mgSamples: mgTimes.length,
      };
    }

    if (pgTimes.length === 0 && mgTimes.length > 0) {
      return single(op, "mongo", pgTimes, mgTimes);
    }
    if (mgTimes.length === 0 && pgTimes.length > 0) {
      return single(op, "postgres", pgTimes, mgTimes);
    }
    if (pgTimes.length === 0 && mgTimes.length === 0) {
      return {
        op,
        selected: this.options.defaultDb,
        reason: "default",
        pgAvgMs: null,
        mgAvgMs: null,
        pgSamples: 0,
        mgSamples: 0,
      };
    }

    const pgAvg = avg(pgTimes)!;
    const mgAvg = avg(mgTimes)!;
    const selected: DbName = pgAvg <= mgAvg ? "postgres" : "mongo";
    return {
      op,
      selected,
      reason: "stats",
      pgAvgMs: pgAvg,
      mgAvgMs: mgAvg,
      pgSamples: pgTimes.length,
      mgSamples: mgTimes.length,
    };
  }
}

function single(
  op: RepoOp,
  selected: DbName,
  pgTimes: number[],
  mgTimes: number[],
): DecisionExplanation {
  return {
    op,
    selected,
    reason: "single-side-failure",
    pgAvgMs: avg(pgTimes),
    mgAvgMs: avg(mgTimes),
    pgSamples: pgTimes.length,
    mgSamples: mgTimes.length,
  };
}

function avg(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const sum = xs.reduce((a, b) => a + b, 0);
  return Math.round((sum / xs.length) * 1000) / 1000;
}
