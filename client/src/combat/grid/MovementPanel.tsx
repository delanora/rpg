import type { MovementPathReading, MovementPreviewResponse } from '../../types';
import { distanceLabel } from './distanceFormat';

export type MovementPreviewState = 'idle' | 'loading' | 'ready' | 'error';

export interface MovementPanelProps {
  combatantName: string | null;
  /** Combatente atual pode se mover? (autoridade derivada do servidor/`turnControl`) */
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

/** Rótulo PT-BR dos códigos SANITIZADOS devolvidos pelo servidor. */
const BLOCKER_LABELS: Record<string, string> = {
  MOVEMENT_NOT_ASSESSED: 'A cena não está em modo grade.',
  MOVEMENT_PLACEMENT_REQUIRED: 'Posicione o combatente antes de mover.',
  MOVEMENT_NOT_CANONICAL: 'A posição atual não está alinhada ao grid.',
  MOVEMENT_OUT_OF_BOUNDS: 'O trajeto sai da cena.',
  MOVEMENT_STEP_NOT_CANONICAL: 'Um passo não está alinhado ao grid.',
  MOVEMENT_STEP_NOT_CONTIGUOUS: 'O trajeto precisa ser contínuo.',
  MOVEMENT_RELATION_UNKNOWN: 'Relação entre criaturas desconhecida: o Mestre decide.',
  MOVEMENT_PATH_BLOCKED: 'Caminho bloqueado.',
  MOVEMENT_DESTINATION_OCCUPIED: 'Destino ocupado.',
  MOVEMENT_INSUFFICIENT_REMAINING: 'Movimento insuficiente.',
  MOVEMENT_SPEED_ZERO: 'Deslocamento efetivo zero.',
};

function feetLabel(feet: number): string {
  const rounded = Math.round(feet * 10) / 10;
  return `${String(rounded).replace('.', ',')} pés`;
}

/**
 * PAINEL compacto do movimento (nunca modal).
 *
 * TODOS os números vêm da resposta do servidor: distância, custo e saldo
 * restante são os do preview/commit. O React não aplica difficult terrain,
 * crawling, Dash, Esquiva ou Opportunity Attack.
 *
 * "Restante após mover" é a diferença aritmética entre dois valores do
 * servidor (saldo − custo), não uma segunda contabilidade local.
 */
export function MovementPanel({
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
}: MovementPanelProps) {
  const legal = Boolean(movement?.legal);
  const affordable = Boolean(movement?.affordable);
  const canConfirm =
    eligible && !busy && pathLength > 0 && state !== 'loading' && legal && affordable;

  const status = !eligible
    ? (reason ?? 'Este combatente não pode se mover agora.')
    : pendingNotice
      ? pendingNotice
      : state === 'loading'
        ? 'Calculando…'
        : state === 'error'
          ? (error ?? 'Não foi possível calcular o trajeto.')
          : !movement || pathLength === 0
            ? 'Arraste o token (ou toque nas células) para montar o trajeto.'
            : !legal
              ? (movement.blocker ? BLOCKER_LABELS[movement.blocker.code] ?? 'O trajeto não é válido.' : 'O trajeto não é válido.')
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
    <section className="grid-movement-panel" aria-label="Movimento">
      <div className="grid-movement-head">
        <span className="grid-movement-title">Movimento</span>
        <div className="grid-movement-actions">
          <button
            type="button"
            className="btn btn-small"
            disabled={busy || pathLength === 0}
            onClick={onClear}
          >
            Limpar trajeto
          </button>
          <button type="button" className="btn btn-small" disabled={busy} onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </div>

      <p className="grid-movement-route">
        <span className="grid-movement-name">{combatantName ?? 'Combatente'}</span>
        {pathLength > 0 ? (
          <span className="grid-movement-steps">
            {' · '}
            {pathLength} {pathLength === 1 ? 'passo' : 'passos'}
          </span>
        ) : null}
      </p>

      <p className={`grid-movement-status ${tone}`} role="status" aria-live="polite">
        {status}
      </p>

      {movement && pathLength > 0 ? (
        <dl className="grid-movement-numbers">
          <div>
            <dt>Distância</dt>
            <dd>{distanceLabel({ status: 'known', distanceFeet: movement.totalDistanceFeet, provenance: 'grid-2d', algorithm: movement.algorithm, reason: null })}</dd>
          </div>
          <div>
            <dt>Custo</dt>
            <dd>{feetLabel(movement.totalCostFeet)}</dd>
          </div>
          <div>
            <dt>Restante</dt>
            <dd>{feetLabel(movement.movementRemainingFeet)}</dd>
          </div>
          <div>
            <dt>Restante após mover</dt>
            <dd>{feetLabel(movement.movementRemainingFeet - movement.totalCostFeet)}</dd>
          </div>
        </dl>
      ) : null}

      {movement && pathLength > 0 && movement.steps.some((step) => step.difficultTerrain) ? (
        <p className="grid-movement-hint">O servidor marcou terreno difícil neste trajeto.</p>
      ) : null}
      {movement && pathLength > 0 && movement.steps.some((step) => step.crawling) ? (
        <p className="grid-movement-hint">Custo de arrastar-se (Caído) aplicado pelo servidor.</p>
      ) : null}
      {reaction && reaction.risk !== 'none' ? (
        <p className="grid-movement-risk">
          Reação possível no trajeto — o servidor pausa o movimento antes da saída de alcance.
        </p>
      ) : null}
      {reaction && reaction.relationUnknown ? (
        <p className="grid-movement-risk">Relação entre lados desconhecida: o Mestre decide.</p>
      ) : null}

      <button
        type="button"
        className="btn btn-primary btn-small grid-movement-confirm"
        disabled={!canConfirm}
        onClick={onConfirm}
      >
        Confirmar movimento
      </button>
      <p className="grid-movement-hint">Distância, custo e saldo são calculados pelo servidor.</p>
    </section>
  );
}
