import { Icon } from './Icon';

interface HpBarProps {
  current: number;
  max: number;
  /** HP temporário, exibido separadamente quando maior que zero. */
  temp?: number;
  /** Rótulo curto opcional (ex.: nome do combatente). */
  label?: string;
  className?: string;
  /**
   * Em `false`, desenha só a barra — quem usa já mostra os números (ex.: a
   * ficha, onde atual/máximo são campos editáveis ao lado da barra).
   */
  showLabel?: boolean;
}

/**
 * Barra de vida visual: o preenchimento muda de cor conforme a gravidade
 * (verde → âmbar → vermelho) e treme quando o personagem está à beira da morte.
 * Sempre acompanha o número, porque barra sozinha não basta numa ficha.
 */
export function HpBar({ current, max, temp = 0, label, className, showLabel = true }: HpBarProps) {
  const ratio = max > 0 ? current / max : 0;
  const percent = Math.max(0, Math.min(100, ratio * 100));
  const state = percent <= 0 ? 'down' : percent <= 25 ? 'critical' : percent <= 50 ? 'wounded' : 'healthy';

  return (
    <div
      className={`hp ${state}${className ? ` ${className}` : ''}`}
      role="img"
      aria-label={`${label ? `${label}: ` : ''}${current} de ${max} pontos de vida${temp > 0 ? ` mais ${temp} temporários` : ''}`}
    >
      <div className="hp-track">
        <div className="hp-fill" style={{ width: `${percent}%` }} />
        {temp > 0 ? (
          <div
            className="hp-temp"
            title={`HP temporário: ${temp}`}
            style={{ width: `${max > 0 ? Math.min(100, (temp / max) * 100) : 0}%` }}
          />
        ) : null}
      </div>
      {showLabel ? (
        <div className="hp-label">
          <Icon name="heart" size={14} className="hp-heart" />
          <span className="hp-numbers">
            {current}
            <span className="hp-sep">/</span>
            {max}
          </span>
          {temp > 0 ? <span className="hp-badge">+{temp}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
