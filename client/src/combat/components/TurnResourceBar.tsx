import { useEffect, useRef, useState } from 'react';
import { FieldInfo } from '../../components/FieldInfo';
import { Icon } from '../../components/Icon';
import type { TurnEconomy } from '../../types';
import type { EconomyAction } from '../combatApi';
import { RESOURCE_INFO } from '../combatVisuals';
import { ActionMenu } from './ActionMenu';

interface TurnResourceBarProps {
  /** O combate está ativo (fora da espera pela iniciativa). */
  active: boolean;
  isMaster: boolean;
  /** Verdadeiro quando o turno atual é do próprio jogador. */
  isMyTurn?: boolean;
  /** Economia persistida no servidor do combatente que age agora. */
  economy?: TurnEconomy;
  busy?: boolean;
  /**
   * Fim do turno: usa o MESMO avanço já existente (`next-turn`). O mestre pode
   * avançar a qualquer momento; o jogador só o PRÓPRIO turno (o backend
   * confere e recusa fora do turno dele).
   */
  onEndTurn?: () => void;
  /**
   * Ações gerais e movimento: vão para a MESMA infraestrutura de economia
   * (`executeEconomyAction`). Ausente na tela de iniciativa.
   */
  onEconomyAction?: (input: {
    action: EconomyAction;
    description?: string;
    trigger?: string;
    intent?: string;
    distance?: number;
  }) => void;
  /** O combatente que age agora está com o turno ativo. */
  ownTurn?: boolean;
  /** `conditionEffects.canAct` do combatente que age. */
  canAct?: boolean;
  /** Velocidade efetiva em metros (<= 0 bloqueia o gasto de deslocamento). */
  effectiveSpeed?: number;
  /**
   * O combatente está no ciclo de morte (0 PV/Death Saves/pendente/morto): a
   * economia normal fica bloqueada e a barra mostra isso claramente.
   */
  deathBlocked?: boolean;
  /**
   * O Teste contra a Morte DESTE turno ainda não foi rolado: o jogador não pode
   * encerrar o turno (o servidor também recusa).
   */
  deathSavePending?: boolean;
  /**
   * LEVANTAR-SE contextual (só Caído): custo em metros, sem gastar Ação.
   * `available: false` mostra o motivo do bloqueio (velocidade 0 / movimento).
   */
  standUp?: { cost: number; available: boolean; reason?: string } | null;
  onStandUp?: () => void;
  /** Alvos válidos de ESTABILIZAR (0 PV, vivos, não estabilizados). */
  stabilizeTargets?: { id: string; name: string }[];
  onStabilize?: (targetCombatantId: string) => void;
}

/**
 * A BARRA PERSISTENTE é o ponto único de Ação / Ação Bônus / Reação /
 * Deslocamento / Encerrar turno. O menu de AÇÃO abre ANCORADO aqui para CIMA; o
 * deslocamento é gasto inline, sem painel separado. Tudo apenas aciona a
 * economia server-authoritative já existente — a UI não recalcula nada.
 */
export function TurnResourceBar({
  active,
  isMaster,
  isMyTurn = false,
  economy,
  busy = false,
  onEndTurn,
  onEconomyAction,
  ownTurn = false,
  canAct = true,
  effectiveSpeed,
  deathBlocked = false,
  deathSavePending = false,
  standUp = null,
  onStandUp,
  stabilizeTargets = [],
  onStabilize,
}: TurnResourceBarProps) {
  // O mestre encerra a qualquer momento; o jogador, só no próprio turno.
  const canEndTurn = Boolean(active && onEndTurn && (isMaster || isMyTurn));

  const actionsLeft = economy ? economy.actionsGranted - economy.actionsUsed : 0;
  const remaining = economy ? Number((economy.movementBudget - economy.movementUsed).toFixed(2)) : 0;
  const canUseAction = Boolean(
    active && onEconomyAction && economy && canAct && ownTurn && actionsLeft > 0,
  );
  // O menu pode abrir por CONTEXTO mesmo sem Ação livre (Levantar-se não gasta
  // Ação) — mas só quando há algo realmente executável.
  const hasContext = Boolean((standUp && onStandUp) || (stabilizeTargets.length > 0 && onStabilize));
  const canOpenMenu = Boolean(
    active && onEconomyAction && canAct && ownTurn && (actionsLeft > 0 || hasContext),
  );
  const canMove = Boolean(
    active && onEconomyAction && economy && canAct && ownTurn && (effectiveSpeed ?? 0) > 0 && remaining > 0,
  );

  // Em ciclo de morte a barra continua visível, mas inativa e explícita.
  if (active && deathBlocked) {
    return (
      <section className="turn-resource-bar death-blocked" aria-label="Recursos do turno">
        <div className="turn-resource death-blocked-note">
          <Icon name="skull" size={14} />
          <span className="turn-resource-label">
            Sem economia de turno — Testes contra a Morte
          </span>
        </div>
        <div className="turn-resource end">
          {canEndTurn ? (
            <button
              type="button"
              className="end-turn"
              disabled={busy || deathSavePending}
              onClick={onEndTurn}
              aria-label="Encerrar turno"
              title={
                deathSavePending
                  ? 'Você precisa realizar seu Teste Contra a Morte antes de encerrar o turno.'
                  : undefined
              }
            >
              <span className="end-turn-text">Encerrar turno</span>
              <span className="end-turn-arrow" aria-hidden="true">
                <svg viewBox="0 0 20 12" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 6h13" />
                  <path d="M9.5 1.5 15 6l-5.5 4.5" />
                </svg>
              </span>
            </button>
          ) : (
            <span className="turn-resource-state">
              {isMyTurn ? 'encerre quando quiser' : 'aguardando'}
            </span>
          )}
        </div>
        {deathSavePending ? (
          <p className="turn-resource-warning" role="status">
            <Icon name="skull" size={13} /> Role o Teste Contra a Morte antes de
            encerrar o turno.
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section
      className={[
        'turn-resource-bar',
        active ? 'active' : 'inactive',
        active && isMyTurn ? 'mine' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label="Recursos do turno"
    >
      {/* AÇÃO — o próprio bloco abre o menu para cima. */}
      <div className="turn-resource action-cell">
        <ActionMenu
          disabled={busy || !canOpenMenu}
          actionsDisabled={busy || !canUseAction}
          onSelect={(action, extra) => onEconomyAction?.({ action, ...extra })}
          standUp={standUp}
          onStandUp={onStandUp}
          stabilizeTargets={stabilizeTargets}
          onStabilize={onStabilize}
          busy={busy}
        />
        <FieldInfo>{RESOURCE_INFO.action}</FieldInfo>
        <span className="turn-resource-value">
          {active && economy ? `${actionsLeft} / ${economy.actionsGranted}` : 'em espera'}
        </span>
      </div>

      {/* AÇÃO BÔNUS — só uma regra específica concede. */}
      <div className="turn-resource">
        <span className="turn-resource-label">
          Ação bônus <FieldInfo>{RESOURCE_INFO.bonus}</FieldInfo>
        </span>
        <span className="turn-resource-value">
          {active && economy ? (economy.bonusActionUsed ? 'utilizada' : 'disponível*') : 'em espera'}
        </span>
      </div>

      {/* REAÇÃO — retorna no início do próprio turno (Fase 6.1). */}
      <div className="turn-resource">
        <span className="turn-resource-label">
          Reação <FieldInfo>{RESOURCE_INFO.reaction}</FieldInfo>
        </span>
        <span className="turn-resource-value">
          {active && economy ? (economy.reactionAvailable ? 'disponível' : 'utilizada') : 'em espera'}
        </span>
      </div>

      {/* DESLOCAMENTO — gasto inline, com popover de metros. */}
      <MovementCell
        active={active}
        economy={economy}
        canMove={canMove && !busy}
        onSpend={(distance) => onEconomyAction?.({ action: 'move', distance })}
      />

      {/* Fim do turno: mesmo mecanismo de avanço já existente. */}
      <div className="turn-resource end">
        {canEndTurn ? (
          <button
            type="button"
            className="end-turn"
            disabled={busy}
            onClick={onEndTurn}
            aria-label="Encerrar turno"
          >
            <span className="end-turn-text">Encerrar turno</span>
            <span className="end-turn-arrow" aria-hidden="true">
              <svg viewBox="0 0 20 12" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 6h13" />
                <path d="M9.5 1.5 15 6l-5.5 4.5" />
              </svg>
            </span>
          </button>
        ) : (
          <>
            <span className="turn-resource-icon">
              <Icon name="sun" size={13} />
            </span>
            <span className="turn-resource-label">Encerrar turno</span>
            <span className="turn-resource-state">
              {active
                ? isMyTurn
                  ? 'encerre quando quiser'
                  : isMaster
                    ? 'aguardando'
                    : 'aguardando seu turno'
                : 'não controlado'}
            </span>
          </>
        )}
      </div>
    </section>
  );
}

/**
 * Deslocamento na barra: valor restante + botão "Gastar" que abre um popover
 * (abre para cima) com stepper em metros. A unidade é a do sistema (metros).
 * Confirmar chama `move` pelo mesmo canal da economia; nada é recalculado aqui.
 */
function MovementCell({ active, economy, canMove, onSpend }: {
  active: boolean;
  economy?: TurnEconomy;
  canMove: boolean;
  onSpend: (distance: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [meters, setMeters] = useState('1.5');
  const anchor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (anchor.current && !anchor.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const remaining = economy ? Number((economy.movementBudget - economy.movementUsed).toFixed(2)) : 0;
  const value = Number(meters);
  const valid = Number.isFinite(value) && value > 0;

  // Stepper compatível com o fracionário do sistema (incremento de 1,5 m).
  const step = (delta: number) => setMeters((current) => {
    const next = Math.max(1.5, Number((Number(current) + delta).toFixed(2)));
    return String(next);
  });

  return (
    <div className="turn-resource move-cell" ref={anchor}>
      <span className="turn-resource-label">
        Deslocamento <FieldInfo>{RESOURCE_INFO.movement}</FieldInfo>
      </span>
      <span className="turn-resource-value">
        {active && economy ? `${remaining} / ${economy.movementBudget} m` : 'em espera'}
      </span>
      {active ? (
        <button
          type="button"
          className="move-spend"
          disabled={!canMove}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          Gastar
        </button>
      ) : null}

      {open ? (
        <div className="move-popover">
          <p className="move-popover-head">Gastar deslocamento</p>
          <div className="move-stepper">
            <button type="button" onClick={() => step(-1.5)} aria-label="Menos 1,5 m">
              −
            </button>
            <input
              type="number"
              min="1.5"
              step="1.5"
              value={meters}
              aria-label="Metros a gastar"
              onChange={(event) => setMeters(event.target.value)}
            />
            <button type="button" onClick={() => step(1.5)} aria-label="Mais 1,5 m">
              +
            </button>
          </div>
          <button
            type="button"
            className="btn btn-small btn-primary"
            disabled={!valid}
            onClick={() => {
              onSpend(value);
              setOpen(false);
            }}
          >
            Confirmar
          </button>
        </div>
      ) : null}
    </div>
  );
}
