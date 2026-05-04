import { Router, type Request, type Response } from "express";
import type { MetricsRecorder } from "../metrics/repository-metrics.js";
import type { DecisionEngine } from "../repositories/decision-engine.js";

export type MetricsDeps = {
  metrics: MetricsRecorder;
  decision: DecisionEngine;
};

export function buildMetricsRouter(deps: MetricsDeps): Router {
  const router = Router();
  const { metrics, decision } = deps;

  router.get("/source", (_req: Request, res: Response) => {
    res.json({
      source: metrics.getSource(),
      note:
        metrics.getSource() === "redis"
          ? "Summary/recent/decision averages Redis listlərindən (persist)."
          : "Yalnız proses yaddaşı (Redis söndürülüb və ya persist=false).",
    });
  });

  router.get("/summary", async (_req: Request, res: Response) => {
    res.json({ summary: await metrics.summary() });
  });

  router.get("/recent", async (req: Request, res: Response) => {
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    res.json({ items: await metrics.recent(limit) });
  });

  router.get("/http/summary", async (_req: Request, res: Response) => {
    res.json({ summary: await metrics.summaryHttp() });
  });

  router.get("/http/recent", async (req: Request, res: Response) => {
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    res.json({ items: await metrics.recentHttp(limit) });
  });

  router.get("/decision", async (_req: Request, res: Response) => {
    res.json({
      decisions: {
        create: await decision.explain("create"),
        findById: await decision.explain("findById"),
        findAll: await decision.explain("findAll"),
        findByUsername: await decision.explain("findByUsername"),
        update: await decision.explain("update"),
        delete: await decision.explain("delete"),
      },
    });
  });

  router.get("/decision/accuracy", async (_req: Request, res: Response) => {
    res.json(await decision.accuracy());
  });

  return router;
}

export const openApiTags = [
  { name: "Metrics", description: "Repository və HTTP metrikaları + decision" },
];

export const openApiPaths = {
  "/api/metrics/source": {
    get: {
      tags: ["Metrics"],
      summary: "Metrika mənbəyi (redis və ya memory)",
      responses: { "200": { description: "Source info" } },
    },
  },
  "/api/metrics/summary": {
    get: {
      tags: ["Metrics"],
      summary: "Aggregated metrics per repository operation",
      responses: { "200": { description: "Summary" } },
    },
  },
  "/api/metrics/recent": {
    get: {
      tags: ["Metrics"],
      summary: "Recent repository metric records",
      parameters: [
        { name: "limit", in: "query", schema: { type: "integer", default: 100 } },
      ],
      responses: { "200": { description: "Recent items" } },
    },
  },
  "/api/metrics/http/summary": {
    get: {
      tags: ["Metrics"],
      summary: "Aggregated HTTP metrics per route",
      responses: { "200": { description: "Summary" } },
    },
  },
  "/api/metrics/http/recent": {
    get: {
      tags: ["Metrics"],
      summary: "Recent HTTP request metrics",
      parameters: [
        { name: "limit", in: "query", schema: { type: "integer", default: 100 } },
      ],
      responses: { "200": { description: "Recent items" } },
    },
  },
  "/api/metrics/decision": {
    get: {
      tags: ["Metrics"],
      summary: "Current decision per operation (with reason and stats)",
      responses: { "200": { description: "Decisions" } },
    },
  },
  "/api/metrics/decision/accuracy": {
    get: {
      tags: ["Metrics"],
      summary:
        "DecisionEngine düzgünlüyü: hər op üçün engine seçimi vs faktiki sürətli DB",
      responses: { "200": { description: "Per-op + overall accuracy" } },
    },
  },
};
