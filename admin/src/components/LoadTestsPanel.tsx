import { useCallback, useEffect, useState } from "react";
import { fetchWithAuth } from "../auth/fetch";
import LoadTestExplorer from "./LoadTestExplorer";
import SectionHeader from "./SectionHeader";

type ScenarioInfo = {
  id: string;
  title: string;
  description: string;
  durationHint: string;
};

type ScenariosResp = {
  scenarios: ScenarioInfo[];
  defaultAccuracyThreshold: number;
  baseUrlUsed: string;
  k6Binary: string;
  resultsDirectory?: string;
};

type LoadTestResult = {
  scenario: string;
  exitCode: number | null;
  passed: boolean;
  durationMs: number;
  summary: Record<string, unknown> | null;
  stdout: string;
  stderr: string;
  error?: string;
  k6Path: string;
  scriptPath: string;
  savedReport?: { id: string; displayName: string } | null;
};

type LoadTestsPanelProps = {
  onAfterRun?: () => void;
};

export default function LoadTestsPanel({ onAfterRun }: LoadTestsPanelProps) {
  const [meta, setMeta] = useState<ScenariosResp | null>(null);
  const [selected, setSelected] = useState<string>("posts-mixed");
  const [threshold, setThreshold] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [runErr, setRunErr] = useState<string | null>(null);
  const [last, setLast] = useState<LoadTestResult | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const [selectHistoryId, setSelectHistoryId] = useState<string | null>(
    null,
  );

  const onHistorySelectConsumed = useCallback(() => {
    setSelectHistoryId(null);
  }, []);

  const loadMeta = useCallback(async () => {
    setFetchErr(null);
    try {
      const r = await fetchWithAuth("/api/load-tests/scenarios");
      if (!r.ok) {
        throw new Error(`/api/load-tests/scenarios ${r.status}`);
      }
      const data = (await r.json()) as ScenariosResp;
      setMeta(data);
      if (data.defaultAccuracyThreshold !== undefined) {
        setThreshold(String(data.defaultAccuracyThreshold));
      }
    } catch (e) {
      setFetchErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  const run = async () => {
    setBusy(true);
    setRunErr(null);
    setLast(null);
    try {
      const body: { scenario: string; accuracyThreshold?: number } = {
        scenario: selected,
      };
      if (selected === "decision-warmup" && threshold.trim() !== "") {
        const n = Number(threshold);
        if (!Number.isFinite(n)) {
          setRunErr("Threshold rəqəm olmalıdır");
          setBusy(false);
          return;
        }
        body.accuracyThreshold = n;
      }
      const r = await fetchWithAuth("/api/load-tests/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await r.json()) as LoadTestResult & { error?: string };
      if (r.status === 503 && data.scenario) {
        setLast(data as LoadTestResult);
        setHistoryKey((k) => k + 1);
        if (data.savedReport?.id) setSelectHistoryId(data.savedReport.id);
        onAfterRun?.();
        setBusy(false);
        return;
      }
      if (!r.ok) {
        if (r.status === 409 && data.error) {
          setRunErr(data.error);
        } else if (data.error) {
          setRunErr(data.error);
        } else {
          setRunErr(`Xəta: ${r.status}`);
        }
        setBusy(false);
        return;
      }
      setLast(data as LoadTestResult);
      setHistoryKey((k) => k + 1);
      if (data.savedReport?.id) setSelectHistoryId(data.savedReport.id);
      onAfterRun?.();
    } catch (e) {
      setRunErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const current = meta?.scenarios.find((s) => s.id === selected);

  return (
    <div className="panel">
      <SectionHeader
        title="k6 yük testləri"
        description={
          meta
            ? `Testlər serverdə k6 ilə işləyir (${meta.k6Binary}). Hədəf URL: ${meta.baseUrlUsed}.${meta.resultsDirectory ? ` JSON saxlanır: ${meta.resultsDirectory}` : ""} Əməliyyat analitikanı yükləndirir — nəticə faylda + tarixçədə qalır.`
            : "Admin panelindən k6 ssenarilərini işə salır, komanda sətri tələb etməyin."
        }
        actions={
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={() => void loadMeta()}
          >
            Ssenariləri yenilə
          </button>
        }
      />

      {fetchErr && <p className="err">{fetchErr}</p>}

      <div className="form-grid" style={{ marginTop: "0.5rem" }}>
        <label>
          Ssenari
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={busy}
          >
            {(meta?.scenarios ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>

        {selected === "decision-warmup" && (
          <label>
            Decision accuracy minimum faiz (threshold)
            <input
              type="number"
              min={0}
              max={100}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              disabled={busy}
              placeholder={String(meta?.defaultAccuracyThreshold ?? 60)}
            />
          </label>
        )}

        {current && (
          <p className="muted" style={{ margin: 0, fontSize: "0.82rem" }}>
            {current.description}{" "}
            <span className="badge">{current.durationHint}</span>
          </p>
        )}

        {runErr && <p className="err">{runErr}</p>}

        <div className="row">
          <button type="button" onClick={() => void run()} disabled={busy || !meta}>
            {busy ? "Test işləyir… (səhifəni bağlamayın)" : "Testi başlat"}
          </button>
          {busy && (
            <span className="muted" style={{ fontSize: "0.85rem" }}>
              Uzun müddətli testlər bir neçə dəqiqə çəkə bilər.
            </span>
          )}
        </div>
      </div>

      {last && (
        <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div className="row between">
            <strong>
              Nəticə: {last.scenario}
              {last.savedReport && (
                <span className="badge" style={{ marginLeft: 8 }}>
                  {last.savedReport.displayName} ↑ JSON yadda
                </span>
              )}
            </strong>
            <span className={last.passed ? "tag tag-ok" : "tag tag-bad"}>
              {last.passed ? "PASS (threshold & exit 0)" : "FAIL"}
            </span>
          </div>
          <p className="muted" style={{ margin: 0 }}>
            Müddət: {(last.durationMs / 1000).toFixed(2)} s · exitCode:{" "}
            {last.exitCode === null ? "—" : last.exitCode}
          </p>
          {last.error && (
            <div className="tag tag-bad" style={{ whiteSpace: "pre-wrap" }}>
              {last.error}
            </div>
          )}

          <details>
            <summary className="muted" style={{ cursor: "pointer" }}>
              k6 summary JSON
            </summary>
            <pre
              className="mono"
              style={{
                fontSize: "0.72rem",
                overflow: "auto",
                maxHeight: 220,
                marginTop: "0.5rem",
                padding: "0.75rem",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--panel-elev)",
              }}
            >
              {last.summary ? JSON.stringify(last.summary, null, 2) : "(summary yoxdur)"}
            </pre>
          </details>

          <details open>
            <summary className="muted" style={{ cursor: "pointer" }}>
              Stdout (son hissə)
            </summary>
            <pre
              className="mono"
              style={{
                fontSize: "0.72rem",
                overflow: "auto",
                maxHeight: 280,
                marginTop: "0.5rem",
                padding: "0.75rem",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--panel-elev)",
              }}
            >
              {last.stdout || "(boş)"}
            </pre>
          </details>

          <details>
            <summary className="muted" style={{ cursor: "pointer" }}>
              Stderr
            </summary>
            <pre
              className="mono"
              style={{
                fontSize: "0.72rem",
                overflow: "auto",
                maxHeight: 160,
                marginTop: "0.5rem",
                padding: "0.75rem",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--panel-elev)",
              }}
            >
              {last.stderr || "(boş)"}
            </pre>
          </details>

          <p className="muted mono" style={{ margin: 0, fontSize: "0.72rem" }}>
            Skript: {last.scriptPath}
          </p>
        </div>
      )}

      <LoadTestExplorer
        refreshKey={historyKey}
        selectIdAfterRefresh={selectHistoryId}
        onSelectIdConsumed={onHistorySelectConsumed}
      />
    </div>
  );
}
