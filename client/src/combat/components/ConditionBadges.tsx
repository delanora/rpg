import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { conditionDamageFamily, conditionDescription } from '../combatVisuals';
import type { ConditionEffects, MechanicalState } from '../../types';

/** Quantas etiquetas cabem no card antes de resumir o resto em "+N". */
const MAX_VISIBLE_CONDITIONS = 4;

type TipPosition = { top: number; left: number; above: boolean };

/**
 * TOOLTIP DE CONDIÇÃO FORA DO PAINEL.
 *
 * A descrição era `position: absolute` DENTRO da etiqueta: no painel da
 * iniciativa (que rola), ela era recortada e, pior, alargava a área de rolagem
 * — aparecia uma barra HORIZONTAL só para caber o texto.
 *
 * Aqui o popup é PORTADO para o `body` e posicionado em `fixed` a partir do
 * retângulo da etiqueta: fica por cima de tudo, não participa do layout de
 * nenhum ancestral e existe só enquanto o ponteiro/foco está na etiqueta.
 */
function useFloatingConditionTip() {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<TipPosition | null>(null);

  const place = useCallback(() => {
    const anchor = ref.current;
    if (!anchor || typeof window === 'undefined') return;
    const rect = anchor.getBoundingClientRect();
    // Alinhado à esquerda da etiqueta; o ajuste de borda direita depende da
    // largura REAL do popup e é feito depois de montar (ver FloatingConditionTip).
    const left = Math.max(8, rect.left);
    const above = rect.bottom + 200 > window.innerHeight;
    setPos({ top: above ? rect.top - 6 : rect.bottom + 6, left, above });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    const onMove = (): void => place();
    // `capture` pega a rolagem de qualquer ancestral (o painel da iniciativa).
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, place]);

  return {
    ref,
    open,
    pos,
    show: (): void => setOpen(true),
    hide: (): void => setOpen(false),
  };
}

/**
 * O popup flutuante em si: portal no `body`, fixo, sem capturar o ponteiro.
 *
 * `data-condition` viaja junto porque o popup sai da etiqueta: é o que permite
 * o CSS pintar a borda com a MESMA cor da condição (a paleta `--condition-*`).
 */
function FloatingConditionTip({ pos, condition, children }: {
  pos: TipPosition | null;
  condition: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [left, setLeft] = useState<number | null>(null);

  // A largura acompanha o CONTEÚDO, então só dá para saber se ele cabe à
  // direita depois de montar: aqui o popup é preso à viewport, sem cortar.
  useEffect(() => {
    const element = ref.current;
    if (!element || !pos || typeof window === 'undefined') return;
    setLeft(Math.max(8, Math.min(pos.left, window.innerWidth - element.offsetWidth - 8)));
  }, [pos, children]);

  if (!pos) return null;
  return createPortal(
    <span
      ref={ref}
      className="info-tip-text condition-tip condition-tip-floating"
      role="tooltip"
      data-condition={condition}
      style={{
        top: `${pos.top}px`,
        left: `${left ?? pos.left}px`,
        transform: pos.above ? 'translateY(-100%)' : undefined,
      }}
    >
      {children}
    </span>,
    document.body,
  );
}

/**
 * Uma etiqueta de condição INTERATIVA: o hover/focus na própria etiqueta abre a
 * explicação curta (PHB 2014). Não há ícone "i" — a etiqueta é o gatilho. A cor
 * semântica vem do atributo `data-condition` no CSS, que reaproveita a família
 * `--damage-*` quando há associação clara (Envenenado ↔ Veneno).
 */
function ConditionChip({ condition, label, count, suspended, sources, onOpenHistory }: {
  condition: string;
  label: string;
  count: number;
  suspended: boolean;
  sources: string[];
  /** Quando existe, a etiqueta abre a janela do histórico mecânico. */
  onOpenHistory?: (condition: string) => void;
}) {
  const family = conditionDamageFamily(condition);
  const tip = useFloatingConditionTip();
  const content = (
    <>
      <strong>{label}</strong>
      {conditionDescription(condition)}
      {sources.length > 0 ? (
        <span className="condition-tip-sources">Fontes: {sources.join(' · ')}</span>
      ) : null}
    </>
  );

  return (
    <span
      ref={tip.ref}
      className={onOpenHistory ? 'condition-chip info-tip is-clickable' : 'condition-chip info-tip'}
      data-condition={condition}
      data-damage-family={family ?? undefined}
      tabIndex={0}
      role={onOpenHistory ? 'button' : 'note'}
      aria-haspopup={onOpenHistory ? 'dialog' : undefined}
      onClick={onOpenHistory ? () => onOpenHistory(condition) : undefined}
      onKeyDown={
        onOpenHistory
          ? (event) => {
              // Teclado: Enter/Espaço fazem o mesmo que o clique.
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              onOpenHistory(condition);
            }
          : undefined
      }
      onPointerEnter={tip.show}
      onPointerLeave={tip.hide}
      onFocus={tip.show}
      onBlur={tip.hide}
    >
      <span className="condition-chip-label">
        {label}
        {count > 1 ? ` ×${count}` : ''}
        {suspended ? ' (suspenso)' : ''}
      </span>
      {/* Cópia inline: markup de SSR apenas — o CSS a mantém oculta; quem
          mostra a descrição é o portal (por isso não há piscada de rolagem). */}
      <span
        className="info-tip-text condition-tip"
        role="tooltip"
      >
        {content}
      </span>
      {tip.open ? (
        <FloatingConditionTip pos={tip.pos} condition={condition}>
          {content}
        </FloatingConditionTip>
      ) : null}
    </span>
  );
}

/** Etiqueta "+N": mesma mecânica de popup flutuante das condições visíveis. */
function MoreConditionsChip({ labels }: { labels: string[] }) {
  const tip = useFloatingConditionTip();
  const content = (
    <>
      <strong>Outras condições</strong>
      {labels.join(' · ')}
    </>
  );
  return (
    <span
      ref={tip.ref}
      className="condition-chip more info-tip"
      tabIndex={0}
      role="note"
      onPointerEnter={tip.show}
      onPointerLeave={tip.hide}
      onFocus={tip.show}
      onBlur={tip.hide}
    >
      +{labels.length}
      <span
        className="info-tip-text condition-tip"
        role="tooltip"
      >
        {content}
      </span>
      {tip.open ? (
        <FloatingConditionTip pos={tip.pos} condition="more">
          {content}
        </FloatingConditionTip>
      ) : null}
    </span>
  );
}

/**
 * Etiquetas de condições ativas. Apresentação apenas: nomes e efeitos vêm do
 * servidor. A Exaustão é uma REGRA OPCIONAL da mesa — quando está desligada, o
 * nível salvo continua na ficha (nunca é apagado), mas o status NÃO aparece.
 *
 * Para várias condições, mostra até `MAX_VISIBLE_CONDITIONS` e resume o resto
 * em um chip `+N` (com a lista no tooltip): 6 condições não esticam o card.
 */
export function ConditionBadges({ state, effects, exhaustionEnabled = effects.exhaustionEnabled, onOpenHistory }: {
  state: MechanicalState;
  effects: ConditionEffects;
  /** Sobrepõe o valor derivado do DTO (usado pela ficha, que ouve `game:config`). */
  exhaustionEnabled?: boolean;
  /**
   * Abre a janela do histórico ao clicar numa etiqueta. Só a FICHA passa isto;
   * no card da iniciativa as etiquetas continuam apenas informativas.
   */
  onOpenHistory?: (condition: string) => void;
}) {
  const grouped = [...new Set(state.conditions.map((instance) => instance.condition))];
  if (grouped.length === 0 && !exhaustionEnabled) return null;
  const visible = grouped.slice(0, MAX_VISIBLE_CONDITIONS);
  const hidden = grouped.slice(MAX_VISIBLE_CONDITIONS);
  return (
    <div className="condition-chips">
      {visible.map((condition) => {
        const sources = state.conditions.filter((instance) => instance.condition === condition);
        return (
          <ConditionChip
            key={condition}
            condition={condition}
            label={effects.labels[condition] ?? condition}
            count={sources.length}
            suspended={condition === 'poisoned' && effects.poisonSuspended}
            sources={sources.map((instance) => instance.sourceLabel ?? 'Origem não informada')}
            onOpenHistory={onOpenHistory}
          />
        );
      })}
      {hidden.length > 0 ? (
        <MoreConditionsChip labels={hidden.map((condition) => effects.labels[condition] ?? condition)} />
      ) : null}
      {exhaustionEnabled ? (
        <span className="condition-chip exhaustion" data-condition="exhaustion">
          Exaustão {state.exhaustionLevel}/6
        </span>
      ) : null}
    </div>
  );
}
