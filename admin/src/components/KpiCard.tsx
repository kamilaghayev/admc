import type { ReactNode } from "react";

export type KpiTone = "neutral" | "ok" | "warn" | "bad";

export type KpiCardProps = {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: KpiTone;
  help?: string;
  sub?: ReactNode;
};

export default function KpiCard({
  label,
  value,
  hint,
  tone = "neutral",
  help,
  sub,
}: KpiCardProps) {
  return (
    <div className={`kpi kpi-${tone}`} title={help}>
      <div className="kpi-label">
        {label}
        {help && (
          <span className="kpi-help" aria-hidden="true">
            ?
          </span>
        )}
      </div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
      {hint && <div className="kpi-hint">{hint}</div>}
    </div>
  );
}
