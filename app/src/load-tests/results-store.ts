import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { DecisionAccuracyReport } from "../repositories/decision-engine.js";
import type {
  HttpMetricRecord,
  HttpPathSummary,
  MetricRecord,
  OpSummary,
} from "../metrics/repository-metrics.js";
import type { LoadTestScenarioId, LoadTestResult } from "./runner.js";

export const LOAD_TEST_SCHEMA_VERSION = 1 as const;

export type LoadTestMetricsSnapshot = {
  metricsSource: "redis" | "memory";
  repoSummary: OpSummary[];
  httpSummary: HttpPathSummary[];
  decisionAccuracy: DecisionAccuracyReport;
  /** Son repo əməliyyat qeydləri (performans paylanması üçün) */
  recentRepo: MetricRecord[];
  /** Son HTTP sorğuları */
  recentHttp: HttpMetricRecord[];
};

export type LoadTestPersistedReport = {
  schemaVersion: typeof LOAD_TEST_SCHEMA_VERSION;
  /** Fayl kimliyi (disk adı üçün, path traversal üçün təhlükəsiz) */
  id: string;
  /** İnsana oxunuşlu ardıcıllıq: TEST1, TEST2, … */
  displayName: string;
  /** Qısa təsadüfi etiket (eyni TEST nömrəsində fərqləndirmə üçün) */
  randomTag: string;
  createdAt: string;
  scenario: LoadTestScenarioId;
  accuracyThresholdUsed?: number;
  k6: LoadTestResult;
  metricsSnapshot: LoadTestMetricsSnapshot;
};

export type LoadTestResultListItem = {
  id: string;
  displayName: string;
  randomTag: string;
  createdAt: string;
  scenario: LoadTestScenarioId;
  passed: boolean;
  durationMs: number;
  exitCode: number | null;
};

function safeJoinedFile(resultsDir: string, id: string): string | null {
  const base = path.resolve(resultsDir);
  if (!/^[\w-]+$/.test(id)) return null;
  const cand = path.resolve(base, `${id}.json`);
  const rel = path.relative(base, cand);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return cand;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function nextDisplayName(resultsDir: string): Promise<string> {
  await ensureDir(resultsDir);
  let entries: string[] = [];
  try {
    entries = await fs.readdir(resultsDir);
  } catch {
    return "TEST1";
  }

  let maxNum = 0;
  const jsonFiles = entries.filter((e) => e.endsWith(".json"));
  await Promise.all(
    jsonFiles.map(async (fname) => {
      try {
        const raw = await fs.readFile(path.join(resultsDir, fname), "utf8");
        const d = JSON.parse(raw) as { displayName?: string };
        const m = /^TEST(\d+)$/i.exec(d.displayName?.trim() ?? "");
        if (m) maxNum = Math.max(maxNum, parseInt(m[1]!, 10));
      } catch {
        /* ignore */
      }
    }),
  );
  return `TEST${maxNum + 1}`;
}

function newReportId(): string {
  const t = Date.now();
  const h = randomBytes(4).toString("hex");
  return `${t}-${h}`;
}

export function resolveResultsDir(custom: string | null, cwdFallback: string): string {
  if (custom?.trim()) return path.resolve(custom.trim());
  return path.resolve(cwdFallback, "data", "load-test-results");
}

export async function saveLoadTestReport(
  resultsDir: string,
  input: {
    scenario: LoadTestScenarioId;
    accuracyThresholdUsed?: number;
    k6: LoadTestResult;
    metricsSnapshot: LoadTestMetricsSnapshot;
  },
): Promise<{ id: string; displayName: string }> {
  await ensureDir(resultsDir);
  const id = newReportId();
  const displayName = await nextDisplayName(resultsDir);
  const randomTag = randomBytes(3).toString("hex").toUpperCase();

  const doc: LoadTestPersistedReport = {
    schemaVersion: LOAD_TEST_SCHEMA_VERSION,
    id,
    displayName,
    randomTag,
    createdAt: new Date().toISOString(),
    scenario: input.scenario,
    accuracyThresholdUsed: input.accuracyThresholdUsed,
    k6: input.k6,
    metricsSnapshot: input.metricsSnapshot,
  };

  const fp = path.join(resultsDir, `${id}.json`);
  await fs.writeFile(fp, JSON.stringify(doc, null, 2), "utf8");
  return { id, displayName };
}

export async function listLoadTestReports(
  resultsDir: string,
): Promise<LoadTestResultListItem[]> {
  await ensureDir(resultsDir);
  let entries: string[] = [];
  try {
    entries = await fs.readdir(resultsDir);
  } catch {
    return [];
  }

  const out: LoadTestResultListItem[] = [];
  for (const fname of entries) {
    if (!fname.endsWith(".json")) continue;
    const id = fname.replace(/\.json$/, "");
    try {
      const raw = await fs.readFile(path.join(resultsDir, fname), "utf8");
      const d = JSON.parse(raw) as Partial<LoadTestPersistedReport>;
      if (
        typeof d.displayName !== "string" ||
        typeof d.createdAt !== "string" ||
        typeof d.scenario !== "string" ||
        !d.k6 ||
        typeof d.k6.passed !== "boolean"
      ) {
        continue;
      }
      out.push({
        id: d.id ?? id,
        displayName: d.displayName,
        randomTag:
          typeof d.randomTag === "string" ? d.randomTag : "?",
        createdAt: d.createdAt,
        scenario: d.scenario as LoadTestScenarioId,
        passed: d.k6.passed,
        durationMs: d.k6.durationMs,
        exitCode: d.k6.exitCode ?? null,
      });
    } catch {
      continue;
    }
  }
  out.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return out;
}

export async function readLoadTestReport(
  resultsDir: string,
  id: string,
): Promise<LoadTestPersistedReport | null> {
  const fp = safeJoinedFile(resultsDir, id);
  if (!fp) return null;
  try {
    const raw = await fs.readFile(fp, "utf8");
    return JSON.parse(raw) as LoadTestPersistedReport;
  } catch {
    return null;
  }
}

export function resolvedReportFilePath(resultsDir: string, id: string): string | null {
  return safeJoinedFile(resultsDir, id);
}
