import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchWithAuth } from "../auth/fetch";

/** API-dən gələn tam JSON (UI üçün tip yalnız lazım olan hissələr müəyyəndir) */

type PersistedMetrics = {
  metricsSource?: string;
  repoSummary?: Array<{
    op: string;
    count: number;
    avgPostgresMs: number | null;
    avgMongoMs: number | null;
    postgresWins: number;
    mongoWins: number;
    postgresFailures?: number;
    mongoFailures?: number;
  }>;
  httpSummary?: Array<{
    path: string;
    method: string;
    count: number;
    avgTotalMs: number | null;
    avgPostgresMs: number | null;
    avgMongoMs: number | null;
  }>;
  decisionAccuracy?: {
    perOp?: Array<{
      op: string;
      pgAvgMs: number | null;
      mgAvgMs: number | null;
      selected: string;
      fasterDb: string | null;
      correct: boolean | null;
    }>;
    overall?: { evaluated: number; correct: number; accuracyPct: number | null };
  };
};

export type PersistedReport = {
  schemaVersion?: number;
  id: string;
  displayName: string;
  randomTag: string;
  createdAt: string;
  scenario: string;
  accuracyThresholdUsed?: number;
  k6?: {
    passed?: boolean;
    summary?: Record<string, unknown> | null;
    durationMs?: number;
    exitCode?: number | null;
    scenario?: string;
  };
  metricsSnapshot?: PersistedMetrics;
};

type ListItem = {
  id: string;
  displayName: string;
  randomTag: string;
  createdAt: string;
  scenario: string;
  passed: boolean;
  durationMs: number;
  exitCode: number | null;
};

type Props = {
  /** Böyümə zamanı tarixçəsi yenidən yükləndirilir */
  refreshKey: number;
  /** Ən son saxlanmış test id seçilsin */
  selectIdAfterRefresh: string | null;
  onSelectIdConsumed?: () => void;
};

export function extractK6DurationMetrics(
  summary: Record<string, unknown> | null | undefined,
): Array<{ name: string; avg: number; p95: number | null }> {
  const m = summary?.metrics as Record<string, unknown> | undefined;
  if (!m || typeof m !== "object") return [];
  const rows: Array<{ name: string; avg: number; p95: number | null }> = [];
  for (const [name, raw] of Object.entries(m)) {
    if (
      typeof name !== "string" ||
      !(name.includes("duration") || name.includes("Duration"))
    ) {
      continue;
    }
    const mv = raw as { values?: Record<string, unknown> };
    const values = mv?.values;
    if (!values || typeof values !== "object") continue;
    const avgRaw = values.avg;
    if (typeof avgRaw !== "number" || Number.isNaN(avgRaw)) continue;
    const p95Raw = values["p(95)"];
    rows.push({
      name: name.length > 32 ? `${name.slice(0, 30)}…` : name,
      avg: avgRaw,
      p95: typeof p95Raw === "number" ? p95Raw : null,
    });
  }
  return rows.sort((a, b) => b.avg - a.avg).slice(0, 18);
}

function chartTooltip(theme: Record<string, string>) {
  return {
    background: theme.panel,
    border: theme.border,
    color: theme.text,
  };
}

/** CSS dəyişənlərindən tooltip oxuma */
function tooltipStyle(): Record<string, string> {
  if (typeof document === "undefined") {
    return { panel: "#1a2332", border: "#2d3848", text: "#e8eaed" };
  }
  const cs = getComputedStyle(document.documentElement);
  return {
    panel: cs.getPropertyValue("--panel").trim() || "#1a2332",
    border: cs.getPropertyValue("--border").trim() || "#2d3848",
    text: cs.getPropertyValue("--text").trim() || "#e8eaed",
  };
}

async function blobDownload(displayName: string, id: string): Promise<void> {
  const r = await fetchWithAuth(`/api/load-tests/results/${id}/download`);
  if (!r.ok) throw new Error(`yükləmə ${r.status}`);
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = `${displayName}_${id}.json`;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function LoadTestExplorer({
  refreshKey,
  selectIdAfterRefresh,
  onSelectIdConsumed,
}: Props) {
  const tt = tooltipStyle();

  const [items, setItems] = useState<ListItem[]>([]);
  const [listErr, setListErr] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [detail, setDetail] = useState<PersistedReport | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadList = useCallback(async () => {
    setListErr(null);
    try {
      const r = await fetchWithAuth("/api/load-tests/results");
      if (!r.ok) throw new Error(`/results ${r.status}`);
      const j = (await r.json()) as { items?: ListItem[] };
      const next = j.items ?? [];
      setItems(next);
      return next;
    } catch (e) {
      setListErr(e instanceof Error ? e.message : String(e));
      return [];
    }
  }, []);

  useEffect(() => {
    void loadList().then(() => {});
  }, [refreshKey, loadList]);

  useEffect(() => {
    if (!selectIdAfterRefresh) return;
    setSelectedId(selectIdAfterRefresh);
    onSelectIdConsumed?.();
  }, [selectIdAfterRefresh, onSelectIdConsumed]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    void (async () => {
      try {
        const r = await fetchWithAuth(`/api/load-tests/results/${selectedId}`);
        if (!r.ok) throw new Error(`${r.status}`);
        setDetail((await r.json()) as PersistedReport);
      } catch {
        setDetail(null);
      } finally {
        setDetailLoading(false);
      }
    })();
  }, [selectedId]);

  const repoRows = useMemo(
    () =>
      (detail?.metricsSnapshot?.repoSummary ?? []).map((r) => ({
        op: r.op,
        "PG ort. (ms)": r.avgPostgresMs ?? 0,
        "MG ort. (ms)": r.avgMongoMs ?? 0,
      })),
    [detail],
  );

  const winsRows = useMemo(
    () =>
      (detail?.metricsSnapshot?.repoSummary ?? []).map((r) => ({
        op: r.op,
        "PG seçimlər": r.postgresWins,
        "MG seçimlər": r.mongoWins,
      })),
    [detail],
  );

  const httpRows = useMemo(() => {
    const rows =
      [...(detail?.metricsSnapshot?.httpSummary ?? [])].sort(
        (a, b) => (b.count ?? 0) - (a.count ?? 0),
      ) ?? [];
    return rows.slice(0, 14).map((r) => ({
      label: `${r.method} ${r.path}`.slice(0, 48),
      "Orta cəm (ms)": r.avgTotalMs ?? 0,
      "Say": r.count,
    }));
  }, [detail]);

  const decisionRows = useMemo(
    () =>
      (detail?.metricsSnapshot?.decisionAccuracy?.perOp ?? []).map((d) => ({
        əməl: d.op,
        PG: d.pgAvgMs ?? 0,
        MG: d.mgAvgMs ?? 0,
      })),
    [detail],
  );

  const k6Trend = useMemo(() => {
    const rows = extractK6DurationMetrics(detail?.k6?.summary ?? null);
    return rows.map((r) => ({
      ...r,
      p95: r.p95 ?? 0,
    }));
  }, [detail]);

  return (
    <div className="panel" style={{ marginTop: "1rem" }}>
      <h2 className="section-title" style={{ marginBottom: "0.35rem" }}>
        Saxlanmış testlər və performansdiaqramlar
      </h2>
      <p className="muted section-desc">
        Hər işlədilmiş test üçün yekunlar{" "}
        <code>.json</code> faylı kimi serverdə yazılır (TEST1, TEST2 sırası ilə ad).
        Əməliyyat üzrə PG/MG gecikmə, seçim sayı, DecisionEngine ilə HTTP route göstəriciləri də bu
        tarixçədədir.
      </p>

      {listErr && <p className="err">{listErr}</p>}

      <div className="row" style={{ marginTop: "0.75rem", flexWrap: "wrap", gap: "0.65rem" }}>
        <label style={{ flex: "1 1 220px", marginBottom: 0 }}>
          <span className="muted" style={{ fontSize: "0.78rem", display: "block" }}>
            Test seç
          </span>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            disabled={items.length === 0}
          >
            <option value="">— tarixçədə test yoxdur —</option>
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                {it.displayName} ({it.randomTag}) ·{" "}
                {it.passed ? "PASS" : "FAIL"} · {it.scenario} ·{" "}
                {new Date(it.createdAt).toLocaleString()}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="ghost" onClick={() => void loadList()}>
          Siyahını yenilə
        </button>
        <button
          type="button"
          className="ghost"
          disabled={!detail}
          onClick={() => detail && blobDownload(detail.displayName, detail.id).catch(console.error)}
        >
          JSON faylı yüklə
        </button>
      </div>

      {detailLoading && selectedId && (
        <p className="muted" style={{ marginTop: "0.75rem" }}>
          Hesabat yüklənir…
        </p>
      )}

      {detail && !detailLoading && (
        <div className="stack" style={{ marginTop: "1rem" }}>
          <div className="row between" style={{ flexWrap: "wrap" }}>
            <div>
              <strong>
                {detail.displayName}{" "}
                <span className="badge">#{detail.randomTag}</span>
              </strong>
              <div className="muted" style={{ fontSize: "0.82rem", marginTop: "0.2rem" }}>
                Ssenari: <code>{detail.scenario}</code> · tarix:{" "}
                {new Date(detail.createdAt).toLocaleString()} · mənbə:{" "}
                {detail.metricsSnapshot?.metricsSource ?? "—"}
              </div>
            </div>
            <span className={detail.k6?.passed ? "tag tag-ok" : "tag tag-bad"}>
              k6: {detail.k6?.passed ? "PASS" : "FAIL"}
            </span>
          </div>

          {detail.metricsSnapshot?.decisionAccuracy?.overall?.accuracyPct != null && (
            <p className="muted">
              DecisionEngine dəqiqliyi:{" "}
              <strong>{detail.metricsSnapshot.decisionAccuracy.overall.accuracyPct}%</strong> ·
              qiymətləndirilən:{" "}
              {detail.metricsSnapshot.decisionAccuracy.overall.evaluated}
            </p>
          )}

          <div className="grid grid-2" style={{ gap: "1rem" }}>
            <div>
              <h3 className="panel" style={{ fontSize: "0.88rem", margin: 0, padding: "0.5rem 0.75rem", borderBottom: "1px solid var(--border)", borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
                Repo əməliyyatı — orta gecikmə (PG vs MG, ms)
              </h3>
              <div className="panel" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0, marginTop: 0 }}>
                <div style={{ height: Math.max(260, repoRows.length * 28) }}>
                  <ResponsiveContainer>
                    <BarChart data={repoRows} layout="vertical" margin={{ left: 8, right: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                      <XAxis type="number" tick={{ fill: "var(--muted)", fontSize: 10 }} />
                      <YAxis dataKey="op" type="category" width={100} tick={{ fill: "var(--muted)", fontSize: 10 }} />
                      <Tooltip contentStyle={chartTooltip(tt)} />
                      <Legend />
                      <Bar dataKey="PG ort. (ms)" fill="var(--accent)" name="PostgreSQL ort." />
                      <Bar dataKey="MG ort. (ms)" fill="var(--accent-2)" name="MongoDB ort." />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div>
              <h3 className="panel" style={{ fontSize: "0.88rem", margin: 0, padding: "0.5rem 0.75rem", borderBottom: "1px solid var(--border)", borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
                Engine tərəfdən seçim sayı
              </h3>
              <div className="panel" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0, marginTop: 0 }}>
                <div style={{ height: Math.max(260, winsRows.length * 28) }}>
                  <ResponsiveContainer>
                    <BarChart data={winsRows} layout="vertical" margin={{ left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                      <XAxis type="number" tick={{ fill: "var(--muted)", fontSize: 10 }} />
                      <YAxis dataKey="op" type="category" width={84} tick={{ fill: "var(--muted)", fontSize: 10 }} />
                      <Tooltip contentStyle={chartTooltip(tt)} />
                      <Legend />
                      <Bar dataKey="PG seçimlər" stackId="a" fill="var(--accent)" />
                      <Bar dataKey="MG seçimlər" stackId="a" fill="var(--accent-2)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>

          <div className="panel">
            <h3 style={{ fontSize: "0.9rem", margin: "0 0 0.5rem" }}>
              DecisionEngine — əməl üzrə PG/MG ort. (snapshot)
            </h3>
            <div style={{ height: Math.max(240, decisionRows.length * 36), width: "100%" }}>
              <ResponsiveContainer>
                <BarChart data={decisionRows}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                  <XAxis dataKey="əməl" tick={{ fill: "var(--muted)", fontSize: 10 }} />
                  <YAxis tick={{ fill: "var(--muted)", fontSize: 10 }} />
                  <Tooltip contentStyle={chartTooltip(tt)} />
                  <Legend />
                  <Bar dataKey="PG" fill="var(--accent)" name="PG ms" />
                  <Bar dataKey="MG" fill="var(--accent-2)" name="MG ms" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel">
            <h3 style={{ fontSize: "0.9rem", margin: "0 0 0.5rem" }}>
              Ən yüklənən HTTP route-lar (orta cəm ms)
            </h3>
            <div style={{ height: Math.min(440, Math.max(240, httpRows.length * 32)), width: "100%" }}>
              <ResponsiveContainer>
                <BarChart data={httpRows} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                  <XAxis type="number" tick={{ fill: "var(--muted)", fontSize: 10 }} />
                  <YAxis dataKey="label" type="category" width={180} tick={{ fill: "var(--muted)", fontSize: 9 }} />
                  <Tooltip contentStyle={chartTooltip(tt)} />
                  <Bar dataKey="Orta cəm (ms)" fill="var(--accent)" name="Orta cavab ms" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel">
            <h3 style={{ fontSize: "0.9rem", margin: "0 0 0.5rem" }}>
              k6 — duration metrikları (orta gecikmə, seçilmiş trend-lər)
            </h3>
            {k6Trend.length === 0 ? (
              <p className="muted">Bu test üçün uyğun k6 metrics obyekti yoxdur və ya eksport olunmayıb.</p>
            ) : (
              <div style={{ height: Math.min(420, Math.max(220, k6Trend.length * 28)), width: "100%" }}>
                <ResponsiveContainer>
                  <BarChart data={k6Trend} layout="vertical" margin={{ left: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                    <XAxis type="number" tick={{ fill: "var(--muted)", fontSize: 10 }} />
                    <YAxis dataKey="name" type="category" width={200} tick={{ fill: "var(--muted)", fontSize: 9 }} />
                    <Tooltip contentStyle={chartTooltip(tt)} />
                    <Legend />
                    <Bar dataKey="avg" fill="var(--accent)" name="Avg (ms)" />
                    <Bar dataKey="p95" fill="var(--accent-2)" name="p95 (ms)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <details>
            <summary className="muted" style={{ cursor: "pointer" }}>
              Saxlanmış tam JSON (oxşar faylda)
            </summary>
            <pre
              className="mono"
              style={{
                fontSize: "0.7rem",
                maxHeight: 320,
                overflow: "auto",
                marginTop: "0.5rem",
                padding: "0.75rem",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--panel-elev)",
              }}
            >
              {(() => {
                const s = JSON.stringify(detail, null, 2);
                return s.length > 95000 ? `${s.slice(0, 95000)}\n… (qısıldı)` : s;
              })()}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
