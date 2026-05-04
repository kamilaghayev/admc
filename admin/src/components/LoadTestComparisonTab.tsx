import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import {
  type ReportForInsights,
  buildComparisonInsights,
} from "../lib/loadTestInsights";
import SectionHeader from "./SectionHeader";

type ListItem = {
  id: string;
  displayName: string;
  randomTag: string;
  createdAt: string;
  scenario: string;
  passed: boolean;
};

function tooltipStyleVars(): Record<string, string> {
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

async function fetchList(): Promise<ListItem[]> {
  const r = await fetchWithAuth("/api/load-tests/results");
  if (!r.ok) throw new Error(`/results ${r.status}`);
  const j = (await r.json()) as { items?: ListItem[] };
  return [...(j.items ?? [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

async function fetchDetail(id: string): Promise<ReportForInsights> {
  const r = await fetchWithAuth(`/api/load-tests/results/${id}`);
  if (!r.ok) throw new Error(`${r.status}`);
  return (await r.json()) as ReportForInsights;
}

const MAX_SELECTED = 8;

export default function LoadTestComparisonTab() {
  const tt = tooltipStyleVars();
  const [items, setItems] = useState<ListItem[]>([]);
  const [listErr, setListErr] = useState<string | null>(null);
  /** Seçimin sırası — müqayisə mətnində də bu ardıcıllıq saxlanılır */
  const [selectionOrder, setSelectionOrder] = useState<string[]>([]);
  const [cache, setCache] = useState<Record<string, ReportForInsights>>({});
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [pendingLoads, setPendingLoads] = useState<Record<string, boolean>>({});
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const fetchingRef = useRef<Set<string>>(new Set());

  const loadList = useCallback(async () => {
    setListErr(null);
    try {
      setItems(await fetchList());
    } catch (e) {
      setListErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const toggle = (id: string) => {
    setSelectionOrder((prev) => {
      const has = prev.includes(id);
      if (has) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_SELECTED) return prev;
      return [...prev, id];
    });
  };

  useEffect(() => {
    if (!selectionOrder.length) return;
    setLoadErr(null);
    for (const id of selectionOrder) {
      if (cacheRef.current[id] || fetchingRef.current.has(id)) continue;
      fetchingRef.current.add(id);
      setPendingLoads((m) => ({ ...m, [id]: true }));
      void fetchDetail(id)
        .then((rep) => {
          setCache((c) => (c[id] ? c : { ...c, [id]: rep }));
        })
        .catch((e) => {
          setLoadErr(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          fetchingRef.current.delete(id);
          setPendingLoads((m) => {
            const next = { ...m };
            delete next[id];
            return next;
          });
        });
    }
  }, [selectionOrder]);

  const orderedReports = useMemo(() => {
    return selectionOrder
      .map((id) => cache[id])
      .filter(Boolean) as ReportForInsights[];
  }, [selectionOrder, cache]);

  const insights = useMemo(
    () => buildComparisonInsights(orderedReports),
    [orderedReports],
  );

  const anyLoading = selectionOrder.some((id) => pendingLoads[id] && !cache[id]);

  return (
    <div className="stack" style={{ gap: "1rem" }}>
      <SectionHeader
        title="JSON hesabatların müqayisəsi və qənaət"
        description="Birdən çox saxlanmış yükləmə testi seçin — diaqramlar və mətn blokları yalnız həmin JSON fayllarındakı özetlər və decisionAccuracy sahələrindən avtomatik hesablanır (təxmini nəticə deyil, fakt uyğunluğu)."
      />

      {listErr && <p className="err">{listErr}</p>}
      {loadErr && <p className="err">{loadErr}</p>}

      <div className="panel">
        <div className="row between" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
          <strong className="section-title">Saxlanmış testlər ({items.length})</strong>
          <button type="button" className="ghost" onClick={() => void loadList()}>
            Siyahını yenilə
          </button>
        </div>

        <p className="muted section-desc">
          Checkbox ilə ən çox {MAX_SELECTED} test seçin. Seçimdə əvvəl işarələdiyiniz sıra qənaət mətnində mövcuddur (eyni məlumat, fərqli ardıcıllıq seçimi təhlilin vurğusu üçün işləməyə bilər — əsasən seçilmiş real JSON-lərə əsasən).
        </p>

        {items.length === 0 && !listErr && (
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            Tarixçədə JSON yoxdur. Əvvəlcə «Yük testləri» tabında test işlədin.
          </p>
        )}

        <ul className="compare-check-list" style={{ marginTop: "0.75rem" }}>
          {items.map((it) => {
            const on = selectionOrder.includes(it.id);
            return (
              <li key={it.id}>
                <label className="row" style={{ alignItems: "flex-start", gap: "0.5rem", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(it.id)}
                    disabled={!on && selectionOrder.length >= MAX_SELECTED}
                  />
                  <span>
                    <strong>{it.displayName}</strong>{" "}
                    <span className="badge">#{it.randomTag}</span>{" "}
                    <span className={it.passed ? "tag tag-ok" : "tag tag-bad"}>
                      {it.passed ? "k6 PASS" : "k6 FAIL"}
                    </span>
                    <br />
                    <span className="muted" style={{ fontSize: "0.78rem" }}>
                      <code>{it.scenario}</code> ·{" "}
                      {new Date(it.createdAt).toLocaleString()}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        {anyLoading && (
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            Seçilmiş hesabatlar yüklənir…
          </p>
        )}
      </div>

      {orderedReports.length > 0 && (
        <>
          <div className="grid grid-2" style={{ gap: "1rem" }}>
            <div className="panel">
              <h3 className="section-title">Repo — seçilmiş testlər üzrə orta PG / MG (ms)</h3>
              <p className="muted section-desc">
                Hər sütunda həmin işin bütün repo əməliyyatları üzrə orta gecikmə göstərilir; aşağı dəyərlər ümumiyyətlə daha yaxşıdır.
              </p>
              <div style={{ width: "100%", height: Math.max(280, insights.chartRepo.length * 52) }}>
                <ResponsiveContainer>
                  <BarChart data={insights.chartRepo} margin={{ bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                    <XAxis dataKey="label" tick={{ fill: "var(--muted)", fontSize: 10 }} />
                    <YAxis tick={{ fill: "var(--muted)", fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{
                        background: tt.panel,
                        border: `1px solid ${tt.border}`,
                        color: tt.text,
                      }}
                    />
                    <Legend />
                    <Bar dataKey="PG ort. (ms)" fill="var(--accent)" name="PostgreSQL ort." />
                    <Bar dataKey="MG ort. (ms)" fill="var(--accent-2)" name="MongoDB ort." />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="panel">
              <h3 className="section-title">DecisionEngine düzgünlüyü (%)</h3>
              <p className="muted section-desc">
                Yalnız snapshot-da <code>decisionAccuracy</code> və kifayət qədər qiymətləndirmə olan testlər üçün sütun çəkilir.
              </p>
              {insights.chartAccuracy.length === 0 ? (
                <p className="muted">Bu seçimdə uyğun faiz dataları yoxdur.</p>
              ) : (
                <div
                  style={{
                    width: "100%",
                    height: Math.max(280, insights.chartAccuracy.length * 48),
                  }}
                >
                  <ResponsiveContainer>
                    <BarChart
                      data={insights.chartAccuracy}
                      layout="vertical"
                      margin={{ left: 16 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                      <XAxis type="number" domain={[0, 100]} tick={{ fill: "var(--muted)", fontSize: 10 }} />
                      <YAxis
                        type="category"
                        dataKey="label"
                        width={100}
                        tick={{ fill: "var(--muted)", fontSize: 10 }}
                      />
                      <Tooltip
                        formatter={(v: number) => [`${v}%`, "Düzgünlük"]}
                        contentStyle={{
                          background: tt.panel,
                          border: `1px solid ${tt.border}`,
                          color: tt.text,
                        }}
                      />
                      <Bar dataKey="accuracyPct" fill="var(--accent)" name="Düzgün %" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          <div className="panel insight-blocks">
            <h3 className="section-title">Performans faktları (müqayisə)</h3>
            <ul className="insight-bullet-list">
              {insights.compareFacts.map((line, i) => (
                <li key={`f-${i}`}>{line}</li>
              ))}
            </ul>
          </div>

          <div className="panel insight-blocks">
            <h3 className="section-title">DecisionEngine təhlili</h3>
            <ul className="insight-bullet-list">
              {insights.decisionAnalysis.map((line, i) => (
                <li key={`d-${i}`}>{line}</li>
              ))}
            </ul>
          </div>

          {insights.gaps.length > 0 && (
            <div className="panel insight-blocks insight-gaps">
              <h3 className="section-title">Məhdudiyyət və boşluqlar</h3>
              <ul className="insight-bullet-list">
                {insights.gaps.map((line, i) => (
                  <li key={`g-${i}`}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="panel insight-conclusion">
            <h3 className="section-title">Qənaət</h3>
            <p className="insight-conclusion-body">{insights.conclusion}</p>
          </div>
        </>
      )}
    </div>
  );
}
