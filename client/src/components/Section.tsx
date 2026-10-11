import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

interface SectionProps {
  title: string;
  subtitle?: string;
  /** Ícone temático exibido junto ao título. */
  icon?: IconName;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Bloco titulado da ficha (uma "página" do grimório). */
export function Section({ title, subtitle, icon, actions, children, className = '' }: SectionProps) {
  return (
    <section className={`sheet-section ${className}`}>
      <header className="section-header">
        <div>
          <h2>
            {icon ? <Icon name={icon} size={20} /> : null}
            {title}
          </h2>
          {subtitle ? <p className="section-subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="section-actions">{actions}</div> : null}
      </header>
      <div className="section-body">{children}</div>
    </section>
  );
}
