import type { User } from "../domain/user.js";
import type {
  DbName,
  MetricRecord,
  MetricsRecorder,
  RepoOp,
} from "../metrics/repository-metrics.js";
import type { DecisionEngine } from "./decision-engine.js";
import type {
  BaseUserRepository,
  ListQuery,
  ReadStrategy,
  UserRepository,
} from "./types.js";

type Settled<T> = {
  value: T | null;
  ok: boolean;
  ms: number | null;
  error?: string;
};

async function timed<T>(fn: () => Promise<T>): Promise<Settled<T>> {
  const start = performance.now();
  try {
    const value = await fn();
    return { value, ok: true, ms: performance.now() - start };
  } catch (err) {
    return {
      value: null,
      ok: false,
      ms: performance.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type SmartUserRepoOptions = {
  strategy: ReadStrategy;
};

export class SmartUserRepository implements UserRepository {
  constructor(
    private readonly pg: BaseUserRepository,
    private readonly mongo: BaseUserRepository,
    private readonly metrics: MetricsRecorder,
    private readonly decision: DecisionEngine,
    private readonly options: SmartUserRepoOptions,
  ) {}

  async insert(user: User): Promise<User> {
    return this.primaryMirrorWrite(
      "create",
      () => this.pg.insert(user),
      () => this.mongo.insert(user),
      user,
    );
  }

  async findById(id: string): Promise<User | null> {
    return this.read(
      "findById",
      () => this.pg.findById(id),
      () => this.mongo.findById(id),
      null,
    );
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.read(
      "findByUsername",
      () => this.pg.findByUsername(username),
      () => this.mongo.findByUsername(username),
      null,
    );
  }

  async findAll(query: ListQuery = {}): Promise<User[]> {
    return this.read(
      "findAll",
      () => this.pg.findAll(query),
      () => this.mongo.findAll(query),
      [] as User[],
    );
  }

  private async primaryMirrorWrite<T>(
    op: RepoOp,
    pgFn: () => Promise<T>,
    mgFn: () => Promise<T>,
    fallback: T,
  ): Promise<T> {
    const primary = await this.decision.decide(op);

    const pgPromise = timed(pgFn);
    const mgPromise = timed(mgFn);

    void Promise.all([pgPromise, mgPromise]).then(([pg, mg]) => {
      const partialFailure = !pg.ok || !mg.ok;
      this.metrics.record(buildMetric(op, pg, mg, primary, partialFailure));
      if (!pg.ok) console.warn(`[smart-user] postgres ${op} failed: ${pg.error}`);
      if (!mg.ok) console.warn(`[smart-user] mongo ${op} failed: ${mg.error}`);
    });

    const primaryRes = await (primary === "postgres" ? pgPromise : mgPromise);
    if (primaryRes.ok) return (primaryRes.value as T) ?? fallback;

    const mirrorRes = await (primary === "postgres" ? mgPromise : pgPromise);
    if (mirrorRes.ok) return (mirrorRes.value as T) ?? fallback;
    throw new Error(
      primaryRes.error ?? mirrorRes.error ?? `${op} failed in both DBs`,
    );
  }

  private async read<T>(
    op: RepoOp,
    pgFn: () => Promise<T>,
    mgFn: () => Promise<T>,
    emptyValue: T,
  ): Promise<T> {
    const strategy = this.options.strategy;
    if (strategy === "postgres") {
      return this.singleRead(op, "postgres", pgFn, mgFn, emptyValue);
    }
    if (strategy === "mongo") {
      return this.singleRead(op, "mongo", pgFn, mgFn, emptyValue);
    }
    if (strategy === "decision") {
      const chosen = await this.decision.decide(op);
      return this.singleRead(op, chosen, pgFn, mgFn, emptyValue);
    }
    return this.raceRead(op, pgFn, mgFn, emptyValue);
  }

  private async singleRead<T>(
    op: RepoOp,
    chosen: DbName,
    pgFn: () => Promise<T>,
    mgFn: () => Promise<T>,
    emptyValue: T,
  ): Promise<T> {
    const fn = chosen === "postgres" ? pgFn : mgFn;
    const result = await timed(fn);
    const pgRes: Settled<T> =
      chosen === "postgres" ? result : { value: null, ok: true, ms: null };
    const mgRes: Settled<T> =
      chosen === "mongo" ? result : { value: null, ok: true, ms: null };
    this.metrics.record(
      buildMetric(op, pgRes, mgRes, result.ok ? chosen : null, !result.ok),
    );
    if (!result.ok) throw new Error(result.error ?? `${op} failed`);
    return (result.value as T) ?? emptyValue;
  }

  private async raceRead<T>(
    op: RepoOp,
    pgFn: () => Promise<T>,
    mgFn: () => Promise<T>,
    emptyValue: T,
  ): Promise<T> {
    const pgPromise = timed(pgFn);
    const mgPromise = timed(mgFn);
    const tagged = [
      pgPromise.then((r) => ({ db: "postgres" as const, r })),
      mgPromise.then((r) => ({ db: "mongo" as const, r })),
    ];

    let winnerDb: DbName | null = null;
    let winnerValue: T | undefined;
    let winnerError: string | undefined;

    try {
      const first = await Promise.any(
        tagged.map(async (p) => {
          const x = await p;
          if (!x.r.ok) throw new Error(x.r.error ?? "read failed");
          return x;
        }),
      );
      winnerDb = first.db;
      winnerValue = first.r.value as T;
    } catch (err) {
      winnerError =
        err instanceof AggregateError
          ? err.errors
              .map((e) => (e instanceof Error ? e.message : String(e)))
              .join("; ")
          : err instanceof Error
            ? err.message
            : String(err);
    }

    void Promise.all([pgPromise, mgPromise]).then(([pg, mg]) => {
      const partialFailure = !pg.ok || !mg.ok;
      const record = buildMetric(op, pg, mg, winnerDb, partialFailure);
      if (winnerError) record.error = winnerError;
      this.metrics.record(record);
    });

    if (winnerDb === null) {
      throw new Error(winnerError ?? `${op} failed in both DBs`);
    }
    return (winnerValue as T) ?? emptyValue;
  }
}

function buildMetric<A, B>(
  op: RepoOp,
  pg: Settled<A>,
  mg: Settled<B>,
  selectedDb: DbName | null,
  partialFailure: boolean,
): MetricRecord {
  return {
    op,
    timestamp: Date.now(),
    postgresMs: pg.ms,
    mongoMs: mg.ms,
    postgresOk: pg.ok,
    mongoOk: mg.ok,
    selectedDb,
    partialFailure,
    error: pg.error ?? mg.error,
  };
}
