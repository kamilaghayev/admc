import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { MetricsRecorder } from "./repository-metrics.js";
import {
  createRequestMetricsCtx,
  requestMetricsStorage,
} from "./request-context.js";

export function requestMetricsMiddleware(
  metrics: MetricsRecorder,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const requestId =
      (req.header("x-request-id") ?? "").trim() || randomUUID();
    const ctx = createRequestMetricsCtx(requestId);

    type WriteHead = Response["writeHead"];
    const origWriteHead = res.writeHead.bind(res) as WriteHead;
    res.writeHead = ((...args: Parameters<WriteHead>) => {
      if (!res.headersSent) {
        res.setHeader("X-Request-Id", ctx.requestId);
        res.setHeader("X-Postgres-Ms", round(ctx.pgMsTotal));
        res.setHeader("X-Mongo-Ms", round(ctx.mongoMsTotal));
        res.setHeader("X-Op-Count", String(ctx.opCount));
        if (ctx.lastSelected) {
          res.setHeader("X-Selected-Db", ctx.lastSelected);
        }
        if (ctx.partialFailures > 0) {
          res.setHeader("X-Partial-Failures", String(ctx.partialFailures));
        }
      }
      return origWriteHead(...args);
    }) as WriteHead;

    res.on("finish", () => {
      const totalMs = performance.now() - ctx.startedAt;
      const path =
        req.route?.path !== undefined
          ? `${req.baseUrl}${req.route.path}`
          : req.originalUrl.split("?")[0]!;
      metrics.recordHttp({
        requestId: ctx.requestId,
        method: req.method,
        path,
        status: res.statusCode,
        totalMs: round(totalMs),
        pgMsTotal: round(ctx.pgMsTotal),
        mongoMsTotal: round(ctx.mongoMsTotal),
        opCount: ctx.opCount,
        selectedCounts: ctx.selectedCounts,
        partialFailures: ctx.partialFailures,
        timestamp: Date.now(),
      });
    });

    requestMetricsStorage.run(ctx, () => next());
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
