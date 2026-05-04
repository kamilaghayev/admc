import { useCallback, useEffect, useMemo, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  Bar,
  BarChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchWithAuth } from "../auth/fetch";
import { useAuth } from "../auth/AuthContext";
import LoadTestComparisonTab from "../components/LoadTestComparisonTab";
import LoadTestsPanel from "../components/LoadTestsPanel";
import KpiCard, { type KpiTone } from "../components/KpiCard";
import SectionHeader from "../components/SectionHeader";

type DashTabId = "live" | "loadTests" | "compare";

type OpSummary = {
  op: string;
  count: number;
  avgPostgresMs: number | null;
  avgMongoMs: number | null;
  postgresWins: number;
  mongoWins: number;
  postgresFailures: number;
  mongoFailures: number;
};

type HttpPathSummary = {
  path: string;
  method: string;
  count: number;
  avgTotalMs: number | null;
  avgPostgresMs: number | null;
  avgMongoMs: number | null;
  avgOpCount: number | null;
};

type DecisionAccuracyOp = {
  op: string;
  selected: "postgres" | "mongo";
  fasterDb: "postgres" | "mongo" | null;
  correct: boolean | null;
  pgAvgMs: number | null;
  mgAvgMs: number | null;
  samples: { pg: number; mg: number };
  reason: "default" | "stats" | "single-side-failure";
};

type DecisionAccuracy = {
  perOp: DecisionAccuracyOp[];
  overall: {
    evaluated: number;
    correct: number;
    accuracyPct: number | null;
  };
};

type MetricRecord = {
  op: string;
  timestamp: number;
  postgresMs: number | null;
  mongoMs: number | null;
  selectedDb: string | null;
  partialFailure: boolean;
};

type HttpMetricRecord = {
  requestId?: string;
  method: string;
  path: string;
  status: number;
  totalMs: number;
  pgMsTotal: number;
  mongoMsTotal: number;
  opCount: number;
  timestamp: number;
};

const MAX_LIVE = 40;
const REASON_LABEL: Record<DecisionAccuracyOp["reason"], string> = {
  default: "isinmə",
  stats: "statistika",
  "single-side-failure": "bir tərəf çalışmır",
};

async function getJson<T>(path: string): Promise<T> {
  const r = await fetchWithAuth(path);
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json() as Promise<T>;
}

function fmtMs(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `${v} ms`;
}

function accuracyTone(pct: number | null): KpiTone {
  if (pct === null) return "neutral";
  if (pct >= 80) return "ok";
  if (pct >= 60) return "warn";
  return "bad";
}

function failureTone(pct: number | null): KpiTone {
  if (pct === null) return "neutral";
  if (pct < 1) return "ok";
  if (pct < 5) return "warn";
  return "bad";
}

export default function AnalyticsDashboard() {
  const { accessToken } = useAuth();
  const [source, setSource] = useState<string>("");
  const [summary, setSummary] = useState<OpSummary[]>([]);
  const [httpSummary, setHttpSummary] = useState<HttpPathSummary[]>([]);
  const [accuracy, setAccuracy] = useState<DecisionAccuracy | null>(null);
  const [recentRepo, setRecentRepo] = useState<MetricRecord[]>([]);
  const [recentHttp, setRecentHttp] = useState<HttpMetricRecord[]>([]);
  const [liveRepo, setLiveRepo] = useState<MetricRecord[]>([]);
  const [liveHttp, setLiveHttp] = useState<HttpMetricRecord[]>([]);
  const [socketOk, setSocketOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dashTab, setDashTab] = useState<DashTabId>("live");

  const refresh = useCallback(async () => {
    try {
      setErr(null);
      const [src, sum, httpSum, acc, recRepo, recHttp] = await Promise.all([
        getJson<{ source: string }>("/api/metrics/source"),
        getJson<{ summary: OpSummary[] }>("/api/metrics/summary"),
        getJson<{ summary: HttpPathSummary[] }>("/api/metrics/http/summary"),
        getJson<DecisionAccuracy>("/api/metrics/decision/accuracy"),
        getJson<{ items: MetricRecord[] }>("/api/metrics/recent?limit=200"),
        getJson<{ items: HttpMetricRecord[] }>(
          "/api/metrics/http/recent?limit=200",
        ),
      ]);
      setSource(src.source);
      setSummary(sum.summary);
      setHttpSummary(httpSum.summary);
      setAccuracy(acc);
      setRecentRepo(recRepo.items);
      setRecentHttp(recHttp.items);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (!accessToken) return;
    const s: Socket = io({
      path: "/socket.io",
      transports: ["websocket", "polling"],
      auth: { token: accessToken },
    });
    s.on("connect", () => setSocketOk(true));
    s.on("disconnect", () => setSocketOk(false));
    s.on("repo:metric", (r: MetricRecord) => {
      setLiveRepo((prev) => [r, ...prev].slice(0, MAX_LIVE));
    });
    s.on("http:metric", (h: HttpMetricRecord) => {
      setLiveHttp((prev) => [h, ...prev].slice(0, MAX_LIVE));
    });
    return () => {
      s.disconnect();
    };
  }, [accessToken]);

  const kpis = useMemo(() => {
    const totalReqs = recentHttp.length;
    const now = Date.now();
    const lastMin = recentHttp.filter((r) => now - r.timestamp < 60_000);
    const rps =
      lastMin.length > 0 ? Math.round((lastMin.length / 60) * 100) / 100 : 0;

    const totalMsValues = recentHttp
      .map((r) => r.totalMs)
      .filter((n): n is number => typeof n === "number");
    const avgTotal =
      totalMsValues.length > 0
        ? Math.round(
            (totalMsValues.reduce((a, b) => a + b, 0) / totalMsValues.length) *
              100,
          ) / 100
        : null;

    const partialN = recentRepo.filter((r) => r.partialFailure).length;
    const failurePct =
      recentRepo.length > 0
        ? Math.round((partialN / recentRepo.length) * 1000) / 10
        : null;

    return {
      totalReqs,
      rps,
      avgTotal,
      failurePct,
      partialN,
    };
  }, [recentHttp, recentRepo]);

  const chartData = summary.map((row) => ({
    op: row.op,
    postgres: row.avgPostgresMs ?? 0,
    mongo: row.avgMongoMs ?? 0,
  }));

  const accuracyPct = accuracy?.overall.accuracyPct ?? null;

  return (
    <div className="wrap">
      <div className="row between" style={{ marginBottom: "0.5rem" }}>
        <h1 style={{ margin: 0 }}>Analitika</h1>
        <div className="row">
          <span className="badge">Mənbə: {source || "—"}</span>
          <span className={socketOk ? "badge badge-live" : "badge"}>
            Socket: {socketOk ? "qoşulu" : "gözləyir…"}
          </span>
          <button
            type="button"
            className="ghost"
            onClick={() => void refresh()}
            disabled={loading}
          >
            {loading ? "Yenilənir…" : "Yenilə"}
          </button>
        </div>
      </div>

      <div className="admin-tabs" role="navigation" aria-label="Analitika bölmələri">
        <div className="admin-tabs-list" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={dashTab === "live"}
            className={`admin-tabs-trigger${dashTab === "live" ? " admin-tabs-trigger--active" : ""}`}
            onClick={() => setDashTab("live")}
          >
            Canlı metrikalar
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={dashTab === "loadTests"}
            className={`admin-tabs-trigger${dashTab === "loadTests" ? " admin-tabs-trigger--active" : ""}`}
            onClick={() => setDashTab("loadTests")}
          >
            Yük testləri
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={dashTab === "compare"}
            className={`admin-tabs-trigger${dashTab === "compare" ? " admin-tabs-trigger--active" : ""}`}
            onClick={() => setDashTab("compare")}
          >
            JSON müqayisə & qənaət
          </button>
        </div>
      </div>

      {dashTab === "live" && (
        <>
          {err && <p className="err">{err}</p>}

      <div className="kpi-grid">
        <KpiCard
          label="HTTP sorğu (son buffer)"
          value={kpis.totalReqs.toLocaleString()}
          sub={
            <span className="muted">
              ≈ {kpis.rps} RPS (son 1 dəq)
            </span>
          }
          help="Yaddaşda və ya Redis-də saxlanılan son HTTP metrikalarının sayı, RPS son 60 saniyəyə əsaslanır."
        />
        <KpiCard
          label="Orta cavab vaxtı"
          value={fmtMs(kpis.avgTotal)}
          sub={<span className="muted">bütün route-lar üzrə</span>}
          help="Son HTTP buffer-dəki bütün sorğuların total müddətinin orta dəyəri."
        />
        <KpiCard
          label="DecisionEngine düzgünlüyü"
          value={accuracyPct === null ? "—" : `${accuracyPct}%`}
          sub={
            accuracy ? (
              <span className="muted">
                {accuracy.overall.correct}/{accuracy.overall.evaluated}{" "}
                op qiymətləndirildi
              </span>
            ) : (
              <span className="muted">data gözlənilir…</span>
            )
          }
          tone={accuracyTone(accuracyPct)}
          help="Engine seçdiyi DB son sample-da faktiki sürətli olan DB ilə nə qədər üst-üstə düşür."
        />
        <KpiCard
          label="Hissəvi xətalar"
          value={kpis.failurePct === null ? "—" : `${kpis.failurePct}%`}
          sub={
            <span className="muted">
              {kpis.partialN} / {recentRepo.length} repo əməliyyatı
            </span>
          }
          tone={failureTone(kpis.failurePct)}
          help="Bir DB əməliyyatı uğursuz, digəri uğurlu — adətən yavaşlamış və ya offline tərəf göstəricisidir."
        />
      </div>

      <SectionHeader
        title="DB latency müqayisəsi"
        description="Hər repository əməliyyatı üçün PostgreSQL və MongoDB-nin orta cavab vaxtı (ms). Aşağı = daha yaxşı."
      />
      <div className="panel">
        <div style={{ width: "100%", height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <XAxis
                dataKey="op"
                tick={{ fill: "var(--muted)", fontSize: 11 }}
              />
              <YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  background: "var(--panel)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                }}
              />
              <Legend />
              <Bar dataKey="postgres" fill="var(--accent)" name="PostgreSQL" />
              <Bar dataKey="mongo" fill="var(--accent-2)" name="MongoDB" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <SectionHeader
        title="DecisionEngine paneli"
        description="Engine real vaxtda hər əməliyyat üçün bir DB seçir. Aşağıdakı cədvəldə həm cari seçim, həm də faktiki sürətli olan DB göstərilir."
      />
      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Əməliyyat</th>
                <th>Engine seçimi</th>
                <th>Faktiki sürətli</th>
                <th>Düzgün?</th>
                <th>PG ort.</th>
                <th>MG ort.</th>
                <th>Sample (PG/MG)</th>
                <th>Səbəb</th>
              </tr>
            </thead>
            <tbody>
              {(accuracy?.perOp ?? []).map((p) => (
                <tr key={p.op}>
                  <td className="mono">{p.op}</td>
                  <td>
                    <span className="tag">{p.selected}</span>
                  </td>
                  <td>
                    {p.fasterDb ? (
                      <span className="tag">{p.fasterDb}</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {p.correct === true && (
                      <span className="tag tag-ok">düzgün</span>
                    )}
                    {p.correct === false && (
                      <span className="tag tag-bad">səhv</span>
                    )}
                    {p.correct === null && (
                      <span className="tag tag-warn">data yox</span>
                    )}
                  </td>
                  <td>{fmtMs(p.pgAvgMs)}</td>
                  <td>{fmtMs(p.mgAvgMs)}</td>
                  <td className="mono">
                    {p.samples.pg}/{p.samples.mg}
                  </td>
                  <td className="muted">{REASON_LABEL[p.reason]}</td>
                </tr>
              ))}
              {(!accuracy || accuracy.perOp.length === 0) && (
                <tr>
                  <td colSpan={8} className="muted">
                    Hələ kifayət qədər sample yoxdur.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <SectionHeader
        title="HTTP route performansı"
        description="Hər API endpoint-i üçün ümumi sorğu sayı və orta DB vaxtları (Redis-aggregat və ya yaddaş)."
      />
      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Metod</th>
                <th>Yol</th>
                <th>Sorğu sayı</th>
                <th>Orta cəm (ms)</th>
                <th>PG cəm (ms)</th>
                <th>MG cəm (ms)</th>
              </tr>
            </thead>
            <tbody>
              {httpSummary.map((r) => (
                <tr key={`${r.method} ${r.path}`}>
                  <td>{r.method}</td>
                  <td className="mono">{r.path}</td>
                  <td>{r.count}</td>
                  <td>{r.avgTotalMs ?? "—"}</td>
                  <td>{r.avgPostgresMs ?? "—"}</td>
                  <td>{r.avgMongoMs ?? "—"}</td>
                </tr>
              ))}
              {httpSummary.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    Hələ HTTP metrika yoxdur.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <SectionHeader
        title="Repository xülasəsi"
        description="Hər əməliyyat üzrə PG/MG ortalaması, qalib say və xəta sayı (yığılmış)."
      />
      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Əməliyyat</th>
                <th>Say</th>
                <th>Avg PG</th>
                <th>Avg MG</th>
                <th>PG qalib</th>
                <th>MG qalib</th>
                <th>PG xəta</th>
                <th>MG xəta</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((r) => (
                <tr key={r.op}>
                  <td className="mono">{r.op}</td>
                  <td>{r.count}</td>
                  <td>{r.avgPostgresMs ?? "—"}</td>
                  <td>{r.avgMongoMs ?? "—"}</td>
                  <td>{r.postgresWins}</td>
                  <td>{r.mongoWins}</td>
                  <td>{r.postgresFailures}</td>
                  <td>{r.mongoFailures}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <SectionHeader
        title="Canlı axın (Socket.IO)"
        description="Real vaxtda ötürülən repository və HTTP metrikaları. Yalnız son qoşulduqdan sonrakı hadisələri göstərir."
      />
      <div className="grid grid-2">
        <div className="panel">
          <h2>Repo</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Vaxt</th>
                  <th>Op</th>
                  <th>PG ms</th>
                  <th>MG ms</th>
                  <th>Seçim</th>
                </tr>
              </thead>
              <tbody>
                {liveRepo.map((r, i) => (
                  <tr key={`${r.timestamp}-${i}`}>
                    <td className="mono">
                      {new Date(r.timestamp).toLocaleTimeString()}
                    </td>
                    <td>{r.op}</td>
                    <td>{r.postgresMs ?? "—"}</td>
                    <td>{r.mongoMs ?? "—"}</td>
                    <td>{r.selectedDb ?? "—"}</td>
                  </tr>
                ))}
                {liveRepo.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      Hadisə gözlənilir…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <h2>HTTP</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Yol</th>
                  <th>Status</th>
                  <th>Total ms</th>
                  <th>PG Σ</th>
                  <th>MG Σ</th>
                </tr>
              </thead>
              <tbody>
                {liveHttp.map((r, i) => (
                  <tr key={`${r.timestamp}-${i}`}>
                    <td className="mono">
                      {r.method} {r.path}
                    </td>
                    <td>{r.status}</td>
                    <td>{r.totalMs}</td>
                    <td>{r.pgMsTotal}</td>
                    <td>{r.mongoMsTotal}</td>
                  </tr>
                ))}
                {liveHttp.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      Hadisə gözlənilir…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
        </>
      )}

      {dashTab === "loadTests" && (
        <LoadTestsPanel onAfterRun={() => void refresh()} />
      )}

      {dashTab === "compare" && <LoadTestComparisonTab />}
    </div>
  );
}
