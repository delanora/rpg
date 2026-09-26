import type { ReactNode } from 'react';

interface SectionProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Bloco titulado da ficha ("página" do grimório). */
export function Section({ title, subtitle, actions, children, className = '' }: SectionProps) {
  return (
    <section className={`sheet-section ${className}`}>
      <header className="section-header">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p className="section-subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="section-actions">{actions}</div> : null}
      </header>
      <div className="section-body">{children}</div>
    </section>
  );
}
