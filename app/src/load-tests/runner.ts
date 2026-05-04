import { spawn } from "node:child_process";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { AppEnv } from "../config/env.js";

export const LOAD_TEST_SCENARIOS = [
  {
    id: "posts-mixed",
    title: "Qarışıq posts (CRUD + oxu)",
    description:
      "Post seed, sonra əsasən GET list/detail, ara-sıra POST/PATCH — ümumi API dayanıqlılığı və gecikmə.",
    durationHint: "~3 dəq əsas ssenari",
  },
  {
    id: "auth-flow",
    title: "Auth akışı (login/refresh/logout)",
    description:
      "Admin login → /me və /metrics → refresh rotation (köhnə jti 401) → logout.",
    durationHint: "~1 dəq (iterasiya sayına görə)",
  },
  {
    id: "decision-warmup",
    title: "DecisionEngine + accuracy",
    description:
      "Repo oxu/yazma ilə engine isidir, sonra /metrics/decision/accuracy — threshold PASS/FAIL.",
    durationHint: "~3 dəq + teardown",
  },
] as const;

export type LoadTestScenarioId = (typeof LOAD_TEST_SCENARIOS)[number]["id"];

export type LoadTestRunPayload = {
  scenario: LoadTestScenarioId;
  /** Yalnız decision-warmup üçün; boşdırsa env ACCURACY_THRESHOLD */
  accuracyThreshold?: number;
};

export type LoadTestResult = {
  scenario: LoadTestScenarioId;
  exitCode: number | null;
  passed: boolean;
  durationMs: number;
  summary: Record<string, unknown> | null;
  stdout: string;
  stderr: string;
  error?: string;
  k6Path: string;
  scriptPath: string;
};

function hereDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

/** loadtests/scripts qovluğunu tapmaq: Docker /app/loadtests, lokal isə repo kökü/LOADTESTS_DIR */
export function resolveLoadtestsDir(envOverride: string | null): string {
  if (envOverride) {
    const abs = path.resolve(envOverride);
    if (!fs.existsSync(abs)) {
      throw new Error(`LOADTESTS_DIR yoxdur: ${abs}`);
    }
    return abs;
  }

  const candidates = [
    path.join(process.cwd(), "loadtests"),
    path.join(process.cwd(), "..", "loadtests"),
    path.join(hereDir(), "..", "..", "loadtests"),
    path.join(hereDir(), "..", "..", "..", "loadtests"),
  ];
  for (const c of candidates) {
    const abs = path.resolve(c);
    if (fs.existsSync(path.join(abs, "scenarios"))) return abs;
  }
  throw new Error(
    "loadtests qovluğu tapılmadı. LOADTESTS_DIR təyin et və ya loadtests/, ../loadtests yerdə yerləşdir.",
  );
}

const MAX_TAIL = 120_000;

function tail(s: string, max = MAX_TAIL): string {
  return s.length <= max ? s : `… (${s.length - max} simvol düşürülüb)\n` + s.slice(-max);
}

export async function runLoadTestOnce(
  env: AppEnv,
  payload: LoadTestRunPayload,
): Promise<LoadTestResult> {
  const loadtestsDir = resolveLoadtestsDir(env.loadtestsDirOverride);
  const scenario = payload.scenario;
  const ok = LOAD_TEST_SCENARIOS.some((s) => s.id === scenario);
  if (!ok) {
    throw new Error(`naməlum ssenari: ${String(scenario)}`);
  }

  const scriptRel = path.join("scenarios", `${scenario}.js`);
  const scriptPath = path.join(loadtestsDir, scriptRel);

  const summaryFile = path.join(
    os.tmpdir(),
    `k6-summary-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.json`,
  );

  const childEnv = {
    ...process.env,
    PATH: process.env.PATH,
    HOME: process.env.HOME ?? os.tmpdir(),
    BASE_URL: env.loadTestBaseUrl,
    ADMIN_USERNAME: env.adminUsername,
    ADMIN_PASSWORD: env.adminPassword,
    ACCURACY_THRESHOLD: String(
      payload.accuracyThreshold ?? env.loadTestAccuracyThreshold,
    ),
    NO_COLOR: "1",
  };

  const args = ["run", "--summary-export", summaryFile, scriptPath];

  const start = Date.now();
  let exitCode: number | null = null;

  try {
    const spawnResult = await new Promise<{ ok: boolean; stdout: string; stderr: string }>(
      (resolve) => {
        const chunksOut: Buffer[] = [];
        const chunksErr: Buffer[] = [];

        const child = spawn(env.k6BinaryPath, args, {
          cwd: loadtestsDir,
          env: childEnv as NodeJS.ProcessEnv,
          detached: false,
        });

        child.stdout?.on("data", (ch) => {
          chunksOut.push(Buffer.from(ch));
        });
        child.stderr?.on("data", (ch) => {
          chunksErr.push(Buffer.from(ch));
        });

        const timer = setTimeout(() => {
          child.kill("SIGKILL");
        }, env.loadTestMaxDurationMs);

        child.on("error", (_err) => {
          clearTimeout(timer);
          exitCode = null;
          resolve({
            ok: false,
            stdout: Buffer.concat(chunksOut).toString("utf8"),
            stderr: Buffer.concat(chunksErr).toString("utf8"),
          });
        });

        child.on("close", (code) => {
          clearTimeout(timer);
          exitCode = code ?? 1;
          const out = Buffer.concat(chunksOut).toString("utf8");
          const er = Buffer.concat(chunksErr).toString("utf8");
          resolve({ ok: true, stdout: out, stderr: er });
        });
      },
    );

    const { stdout, stderr } = spawnResult;
    if (!spawnResult.ok) {
      await fsPromises.unlink(summaryFile).catch(() => {});
      return {
        scenario,
        exitCode: null,
        passed: false,
        durationMs: Date.now() - start,
        summary: null,
        stdout: tail(stdout),
        stderr: tail(stderr),
        error: `k6 icra olunmadı («${env.k6BinaryPath}» mövcuddurmu?).`,
        k6Path: env.k6BinaryPath,
        scriptPath,
      };
    }

    let summaryParsed: Record<string, unknown> | null = null;
    try {
      const raw = await fsPromises.readFile(summaryFile, "utf8");
      summaryParsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      summaryParsed = null;
    }

    await fsPromises.unlink(summaryFile).catch(() => {});

    return {
      scenario,
      exitCode,
      passed: exitCode === 0,
      durationMs: Date.now() - start,
      summary: summaryParsed,
      stdout: tail(stdout),
      stderr: tail(stderr),
      k6Path: env.k6BinaryPath,
      scriptPath,
    };
  } catch (err) {
    await fsPromises.unlink(summaryFile).catch(() => {});

    const message = err instanceof Error ? err.message : String(err);
    return {
      scenario,
      exitCode: null,
      passed: false,
      durationMs: Date.now() - start,
      summary: null,
      stdout: "",
      stderr: "",
      error:
        message.includes("ENOENT") || message.includes("spawn")
          ? `k6 icra olunmadı («${env.k6BinaryPath}»). Docker image-də və ya host-da k6 olduğundan əmin ol. (${message})`
          : message,
      k6Path: env.k6BinaryPath,
      scriptPath,
    };
  }
}
