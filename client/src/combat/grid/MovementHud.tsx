import type { MovementPathReading, MovementPreviewResponse } from '../../types';
import { formatMeters } from './distanceFormat';

export type MovementPreviewState = 'idle' | 'loading' | 'ready' | 'error';

export interface MovementHudProps {
  combatantName: string | null;
  /** Combatente atual pode se mover? (autoridade derivada no `turnControl`) */
  eligible: boolean;
  /** Motivo sanitizado quando não pode mover. */
  reason: string | null;
  pathLength: number;
  /** Avaliação SERVER-AUTHORITATIVE do trajeto pretendido. */
  movement: MovementPathReading | null;
  reaction: MovementPreviewResponse['reaction'] | null;
  state: MovementPreviewState;
  /** Erro de rede/preview ou aviso local (commit recusado, cancelamento...). */
  error: string | null;
  pendingNotice: string | null;
  busy: boolean;
  onClear: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Rótulo PT-BR dos códigos SANITIZADOS devolvidos pelo servidor.
 *
 * O jogador NUNCA vê identidade de quem bloqueia: os códigos do servidor já vêm
 * anônimos (`MOVEMENT_PATH_BLOCKED`, `MOVEMENT_DESTINATION_OCCUPIED`...).
 */
const BLOCKER_LABELS: Record<string, string> = {
  MOVEMENT_NOT_ASSESSED: 'A cena não está em modo grade.',
  MOVEMENT_PLACEMENT_REQUIRED: 'Posicione o combatente antes de mover.',
  MOVEMENT_NOT_CANONICAL: 'A posição atual não está alinhada ao grid.',
  MOVEMENT_OUT_OF_BOUNDS: 'O trajeto sai da cena.',
  MOVEMENT_STEP_NOT_CANONICAL: 'Um passo não está alinhado ao grid.',
  MOVEMENT_STEP_NOT_CONTIGUOUS: 'O trajeto precisa ser contínuo.',
  MOVEMENT_RELATION_UNKNOWN: 'Relação desconhecida: o Mestre decide.',
  MOVEMENT_PATH_BLOCKED: 'Caminho bloqueado.',
  MOVEMENT_DESTINATION_OCCUPIED: 'Destino ocupado.',
  MOVEMENT_INSUFFICIENT_REMAINING: 'Movimento insuficiente.',
  MOVEMENT_SPEED_ZERO: 'Deslocamento efetivo zero.',
};

/**
 * FASE 6.6M.3.1 — HUD de movimento (substitui o painel grande da 6.6M.3).
 *
 * Flutua sobre o palco (`position: absolute`), não empurra layout e NÃO duplica
 * a barra persistente de recursos: aqui só aparecem distância/custo e o estado
 * do preview, todos derivados de números do SERVIDOR. O saldo autoritativo
 * continua na barra de ações (`TurnResourceBar`).
 *
 * "Restante previsto" é a subtração de dois valores do servidor (saldo − custo):
 * previsão de leitura, nunca um novo saldo gravado por aqui.
 */
export function MovementHud({
  combatantName,
  eligible,
  reason,
  pathLength,
  movement,
  reaction,
  state,
  error,
  pendingNotice,
  busy,
  onClear,
  onCancel,
  onConfirm,
}: MovementHudProps) {
  const legal = Boolean(movement?.legal);
  const affordable = Boolean(movement?.affordable);
  const hasNumbers = Boolean(movement) && pathLength > 0;
  const canConfirm = eligible && !busy && pathLength > 0 && state !== 'loading' && legal && affordable;

  const status = !eligible
    ? (reason ?? 'Este combatente não pode se mover agora.')
    : pendingNotice
      ? pendingNotice
      : state === 'loading'
        ? 'Calculando…'
        : state === 'error'
          ? (error ?? 'Não foi possível calcular o trajeto.')
          : !movement || pathLength === 0
            ? 'Arraste o token do turno para montar o trajeto.'
            : !legal
              ? movement.blocker
                ? (BLOCKER_LABELS[movement.blocker.code] ?? 'O trajeto não é válido.')
                : 'O trajeto não é válido.'
              : !affordable
                ? 'Movimento insuficiente para este trajeto.'
                : 'Trajeto válido.';

  const tone = !eligible
    ? 'is-neutral'
    : !movement || pathLength === 0
      ? 'is-neutral'
      : !legal
        ? 'is-invalid'
        : !affordable
          ? 'is-insufficient'
          : 'is-valid';

  return (
    <div className="grid-movement-hud" aria-label="Movimento do turno">
      <p className="grid-hud-title">
        {combatantName ?? 'Combatente'}
        {pathLength > 0 ? (
          <span className="grid-hud-steps">
            {' · '}
            {pathLength} {pathLength === 1 ? 'passo' : 'passos'}
          </span>
        ) : null}
      </p>
      {hasNumbers && movement ? (
        <p className="grid-hud-numbers">
          Distância: <strong>{formatMeters(movement.totalDistanceFeet)}</strong>
          {' · '}Custo: <strong>{formatMeters(movement.totalCostFeet)}</strong>
          {' · '}Restante previsto:{' '}
          <strong>{formatMeters(movement.movementRemainingFeet - movement.totalCostFeet)}</strong>
        </p>
      ) : null}
      <p className={`grid-hud-status ${tone}`} role="status" aria-live="polite">
        {status}
      </p>
      {hasNumbers && movement?.steps.some((step) => step.difficultTerrain) ? (
        <p className="grid-hud-hint">Terreno difícil aplicado pelo servidor.</p>
      ) : null}
      {hasNumbers && movement?.steps.some((step) => step.crawling) ? (
        <p className="grid-hud-hint">Custo de arrastar-se (Caído) aplicado pelo servidor.</p>
      ) : null}
      {reaction && reaction.risk !== 'none' ? (
        <p className="grid-hud-risk">Reação possível: o servidor pausa antes da saída de alcance.</p>
      ) : null}
      <div className="grid-hud-actions">
        <button type="button" className="btn btn-small" disabled={busy || pathLength === 0} onClick={onClear}>
          Limpar
        </button>
        <button type="button" className="btn btn-small" disabled={busy} onClick={onCancel}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn-primary btn-small"
          disabled={!canConfirm}
          onClick={onConfirm}
        >
          Confirmar
        </button>
      </div>
    </div>
  );
}
