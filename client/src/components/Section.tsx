import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

interface SectionProps {
  title: string;
  subtitle?: string;
  /** Ícone temático exibido junto ao título. */
  icon?: IconName;
  /**
   * Marcador curto à frente do título (ex.: "A", "B"...), para dar a sensação
   * de sequência editorial às seções de um formulário. Decorativo.
   */
  badge?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Bloco titulado da ficha (uma "página" do grimório). */
export function Section({
  title,
  subtitle,
  icon,
  badge,
  actions,
  children,
  className = '',
}: SectionProps) {
  return (
    <section className={`sheet-section ${className}`}>
      <header className="section-header">
        <div>
          <h2>
            {badge ? (
              <span className="section-badge" aria-hidden="true">
                {badge}
              </span>
            ) : null}
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
