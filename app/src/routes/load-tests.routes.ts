import fsPromises from "node:fs/promises";
import path from "node:path";

import { Router, type Request, type Response } from "express";

import type { AppEnv } from "../config/env.js";
import type { MetricsRecorder } from "../metrics/repository-metrics.js";
import type { DecisionEngine } from "../repositories/decision-engine.js";
import type { LoadTestMetricsSnapshot } from "../load-tests/results-store.js";
import {
  listLoadTestReports,
  readLoadTestReport,
  resolvedReportFilePath,
  saveLoadTestReport,
} from "../load-tests/results-store.js";
import {
  LOAD_TEST_SCENARIOS,
  runLoadTestOnce,
  type LoadTestScenarioId,
} from "../load-tests/runner.js";

export type LoadTestsDeps = {
  env: AppEnv;
  metrics: MetricsRecorder;
  decision: DecisionEngine;
};

async function captureMetricsSnapshot(
  metrics: MetricsRecorder,
  decision: DecisionEngine,
): Promise<LoadTestMetricsSnapshot> {
  const [repoSummary, httpSummary, decisionAccuracy, recentRepo, recentHttp] =
    await Promise.all([
      metrics.summary(),
      metrics.summaryHttp(),
      decision.accuracy(),
      metrics.recent(150),
      metrics.recentHttp(150),
    ]);
  return {
    metricsSource: metrics.getSource(),
    repoSummary,
    httpSummary,
    decisionAccuracy,
    recentRepo,
    recentHttp,
  };
}

let loadTestBusy = false;

export function buildLoadTestsRouter(deps: LoadTestsDeps): Router {
  const router = Router();
  const dir = deps.env.loadTestResultsDir;

  router.get("/scenarios", (_req: Request, res: Response) => {
    res.json({
      scenarios: LOAD_TEST_SCENARIOS.map((s) => ({ ...s })),
      defaultAccuracyThreshold: deps.env.loadTestAccuracyThreshold,
      baseUrlUsed: deps.env.loadTestBaseUrl,
      k6Binary: deps.env.k6BinaryPath,
      resultsDirectory: dir,
    });
  });

  router.get("/results", async (_req: Request, res: Response) => {
    try {
      const items = await listLoadTestReports(dir);
      res.json({ items });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.get("/results/:id", async (req: Request, res: Response) => {
    try {
      const doc = await readLoadTestReport(dir, req.params.id!);
      if (!doc) {
        res.status(404).json({ error: "nəticə tapılmadı" });
        return;
      }
      res.json(doc);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.get("/results/:id/download", async (req: Request, res: Response) => {
    try {
      const fp = resolvedReportFilePath(dir, req.params.id!);
      if (!fp) {
        res.status(400).json({ error: "səhv id" });
        return;
      }
      const doc = await readLoadTestReport(dir, req.params.id!);
      if (!doc) {
        res.status(404).json({ error: "fayl yoxdur" });
        return;
      }
      const safeName =
        `${doc.displayName}_${doc.randomTag}`.replace(/[^\w.-]+/g, "_");
      const fileName =
        `${safeName}_${req.params.id}.json`;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${fileName}"`,
      );
      res.sendFile(path.resolve(fp));
    } catch {
      res.status(404).end();
    }
  });

  router.post("/run", async (req: Request, res: Response) => {
    if (loadTestBusy) {
      res.status(409).json({
        error:
          "Digər yük testi hələ işləyir; bitənə kimi gözləyin və ya növbəti dəfə yenidən yoxlayın.",
      });
      return;
    }

    const body = req.body as { scenario?: string; accuracyThreshold?: number };
    const scenarioRaw = typeof body?.scenario === "string" ? body.scenario.trim() : "";
    const ids = LOAD_TEST_SCENARIOS.map((s) => s.id);
    if (!ids.includes(scenarioRaw as LoadTestScenarioId)) {
      res.status(400).json({
        error: `geçərli scenario tələb olunur: ${ids.join(", ")}`,
      });
      return;
    }

    let thresholdUsed: number | undefined;
    if (body.accuracyThreshold !== undefined) {
      const n = Number(body.accuracyThreshold);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        res.status(400).json({ error: "accuracyThreshold 0–100 olmalıdır" });
        return;
      }
      thresholdUsed = n;
    }

    const scenario = scenarioRaw as LoadTestScenarioId;

    loadTestBusy = true;
    try {
      const result = await runLoadTestOnce(deps.env, {
        scenario,
        accuracyThreshold: thresholdUsed,
      });

      let savedReport: { id: string; displayName: string } | null = null;
      try {
        const metricsSnapshot = await captureMetricsSnapshot(
          deps.metrics,
          deps.decision,
        );
        savedReport = await saveLoadTestReport(dir, {
          scenario,
          accuracyThresholdUsed:
            scenario === "decision-warmup"
              ? (thresholdUsed ?? deps.env.loadTestAccuracyThreshold)
              : thresholdUsed,
          k6: result,
          metricsSnapshot,
        });
      } catch (err) {
        console.error("[load-tests] JSON saxlamada xəta:", err);
      }

      const httpStatus =
        result.error && result.exitCode === null ? 503 : 200;
      res.status(httpStatus).json({
        ...result,
        savedReport,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    } finally {
      loadTestBusy = false;
    }
  });

  return router;
}

export const openApiTags = [
  { name: "LoadTests", description: "Admin: k6 yük testləri və JSON tarixçə" },
];

export const openApiPaths = {
  "/api/load-tests/scenarios": {
    get: {
      tags: ["LoadTests"],
      summary: "Mövcud k6 ssenariləri və default parametrlər",
      responses: { "200": { description: "Ssenari siyahısı" } },
    },
  },
  "/api/load-tests/results": {
    get: {
      tags: ["LoadTests"],
      summary: "Saxlanılmış yükləmə testi JSON tarixçəsi (meta)",
      responses: { "200": { description: "items[]" } },
    },
  },
  "/api/load-tests/results/{id}": {
    get: {
      tags: ["LoadTests"],
      summary: "Tam JSON hesabat (diagram üçün)",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": { description: "LoadTestPersistedReport" },
        "404": { description: "Tapılmadı" },
      },
    },
  },
  "/api/load-tests/results/{id}/download": {
    get: {
      tags: ["LoadTests"],
      summary: "Hesabat faylı kimi yüklə",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: { "200": { description: "application/json attachment" } },
    },
  },
  "/api/load-tests/run": {
    post: {
      tags: ["LoadTests"],
      summary:
        "k6 ssenarisi işə düşür, bitəndə Redis/metrics snapshot + tam JSON saxlanır",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["scenario"],
              properties: {
                scenario: {
                  type: "string",
                  enum: ["posts-mixed", "auth-flow", "decision-warmup"],
                },
                accuracyThreshold: {
                  type: "number",
                  minimum: 0,
                  maximum: 100,
                },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "k6 nəticəsi + savedReport" },
        "503": { description: "k6 tapılmadı" },
        "400": { description: "Səhv parametrlər" },
        "409": { description: "Başqa test işləyir" },
      },
    },
  },
};
