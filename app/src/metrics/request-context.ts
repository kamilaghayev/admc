import { AsyncLocalStorage } from "node:async_hooks";
import type { DbName } from "./repository-metrics.js";

export type RequestMetricsCtx = {
  requestId: string;
  startedAt: number;
  pgMsTotal: number;
  mongoMsTotal: number;
  opCount: number;
  selectedCounts: { postgres: number; mongo: number; none: number };
  partialFailures: number;
  lastSelected: DbName | null;
};

export const requestMetricsStorage = new AsyncLocalStorage<RequestMetricsCtx>();

export function getRequestMetricsCtx(): RequestMetricsCtx | undefined {
  return requestMetricsStorage.getStore();
}

export function createRequestMetricsCtx(requestId: string): RequestMetricsCtx {
  return {
    requestId,
    startedAt: performance.now(),
    pgMsTotal: 0,
    mongoMsTotal: 0,
    opCount: 0,
    selectedCounts: { postgres: 0, mongo: 0, none: 0 },
    partialFailures: 0,
    lastSelected: null,
  };
}
