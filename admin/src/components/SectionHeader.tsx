import type { ReactNode } from "react";

export type SectionHeaderProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
};

export default function SectionHeader({
  title,
  description,
  actions,
}: SectionHeaderProps) {
  return (
    <div className="section-header">
      <div>
        <h2 className="section-title">{title}</h2>
        {description && <p className="section-desc">{description}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}
