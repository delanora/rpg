import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';

/**
 * Contador de Testes contra a Morte (PHB 2014): CORAÇÕES para sucessos e
 * CAVEIRA COM OSSOS CRUZADOS para falhas. Leitura instantânea, tooltip por
 * hover (sem ícone "i") e animação curta apenas no pip que acabou de acender
 * (via realtime).
 *
 * É apresentação pura: o servidor decide os valores; aqui só desenhamos.
 */

function pipsLabel(kind: 'success' | 'failure'): string {
  return kind === 'success' ? 'Sucessos' : 'Falhas';
}

/** Uma trilha de 3 marcas (preenchidas até `filled`). `pulse` acende a última nova. */
function DeathPips({ filled, kind, pulse }: { filled: number; kind: 'success' | 'failure'; pulse?: boolean }) {
  // Falha usa CAVEIRA COM OSSOS CRUZADOS (não a caveira simples).
  const icon = kind === 'success' ? 'heart' : 'crossbones';
  const label = pipsLabel(kind);
  return (
    <span
      className={`death-pips death-pips-${kind}`}
      role="img"
      aria-label={`${label}: ${filled} de 3`}
    >
      {[0, 1, 2].map((index) => {
        const on = index < filled;
        const classes = ['death-pip', on ? 'filled' : ''];
        if (pulse && on && index === filled - 1) classes.push('just-filled');
        return (
          <span
            key={index}
            className={classes.filter(Boolean).join(' ')}
            // Tooltip nativo: reafirma a contagem ao passar o mouse sobre o ícone.
            title={`${label}: ${filled} de 3`}
            aria-hidden="true"
          >
            <Icon name={icon} size={12} />
          </span>
        );
      })}
    </span>
  );
}

interface DeathCounterProps {
  successes: number;
  failures: number;
  /** Mostra os rótulos textuais (♥ 2/3 ☠ 1/3) além dos ícones. */
  showNumbers?: boolean;
  className?: string;
}

export function DeathCounter({ successes, failures, showNumbers = false, className }: DeathCounterProps) {
  const previous = useRef({ successes, failures });
  const [pulse, setPulse] = useState<{ kind: 'success' | 'failure' } | null>(null);

  // Acende só o ícone que ACABOU de encher; nada de animação longa.
  useEffect(() => {
    const before = previous.current;
    if (successes > before.successes) setPulse({ kind: 'success' });
    else if (failures > before.failures) setPulse({ kind: 'failure' });
    previous.current = { successes, failures };
  }, [successes, failures]);

  useEffect(() => {
    if (!pulse) return;
    const timer = setTimeout(() => setPulse(null), 520);
    return () => clearTimeout(timer);
  }, [pulse]);

  return (
    <div className={className ? `death-counter ${className}` : 'death-counter'}>
      <span className="death-counter-side">
        {showNumbers ? <span className="death-counter-num">♥ {successes}/3</span> : null}
        <DeathPips filled={successes} kind="success" pulse={pulse?.kind === 'success'} />
      </span>
      <span className="death-counter-side">
        {showNumbers ? <span className="death-counter-num">☠ {failures}/3</span> : null}
        <DeathPips filled={failures} kind="failure" pulse={pulse?.kind === 'failure'} />
      </span>
    </div>
  );
}
