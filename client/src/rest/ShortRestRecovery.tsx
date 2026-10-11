import { useState } from 'react';
import type { Character } from '../types';
import type { RecoverSlotsResult, RecoveryFeatureId } from '../featuresApi';
import { SPELL_LEVEL_LABELS } from '../dnd';

/**
 * Recuperação Arcana (Mago) e Natural (Druida do Círculo da Terra) — 5.3C.
 *
 * A seleção acontece DENTRO do Descanso Curto, antes de marcar "pronto". O
 * cliente calcula aqui só o que MOSTRAR (o orçamento, como apoio visual); quem
 * valida o orçamento, os gastos, o limite de nível 5 e consome a feature é o
 * servidor — nunca esta tela. Escolher zero e cancelar não gasta nada.
 */

/** Classes que concedem cada recuperação especial. */
const RECOVERY_CLASS_KEY: Record<RecoveryFeatureId, string> = {
  'arcane-recovery': 'wizard',
  'natural-recovery': 'druid',
};

const MAX_RECOVERABLE_LEVEL = 5;

interface RecoveryOption {
  id: RecoveryFeatureId;
  name: string;
  budget: number;
}

/** Features de recuperação DISPONÍVEIS (recurso de recarga longa com saldo). */
function availableRecoveries(character: Character): RecoveryOption[] {
  return character.classAdjustments.resources
    .filter(
      (resource) =>
        (resource.id === 'arcane-recovery' || resource.id === 'natural-recovery') &&
        resource.remaining > 0,
    )
    .map((resource) => {
      const id = resource.id as RecoveryFeatureId;
      const entry = character.classes.find(
        (item) => item.classKey === RECOVERY_CLASS_KEY[id],
      );
      return { id, name: resource.name, budget: Math.ceil((entry?.level ?? 0) / 2) };
    });
}

export function ShortRestRecovery({
  character,
  disabled,
  pending,
  onRecover,
  onApplied,
}: {
  character: Character;
  disabled: boolean;
  pending: boolean;
  onRecover: (
    featureId: RecoveryFeatureId,
    slots: Record<string, number>,
    expectedVersion: number,
  ) => Promise<RecoverSlotsResult | null>;
  onApplied: (result: RecoverSlotsResult) => void;
}) {
  const options = availableRecoveries(character);
  if (options.length === 0) return null;

  return (
    <div className="short-rest-recovery">
      {options.map((option) => (
        <RecoveryRow
          key={option.id}
          character={character}
          option={option}
          disabled={disabled}
          pending={pending}
          onRecover={onRecover}
          onApplied={onApplied}
        />
      ))}
    </div>
  );
}

function RecoveryRow({
  character,
  option,
  disabled,
  pending,
  onRecover,
  onApplied,
}: {
  character: Character;
  option: RecoveryOption;
  disabled: boolean;
  pending: boolean;
  onRecover: (
    featureId: RecoveryFeatureId,
    slots: Record<string, number>,
    expectedVersion: number,
  ) => Promise<RecoverSlotsResult | null>;
  onApplied: (result: RecoverSlotsResult) => void;
}) {
  const [selection, setSelection] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const used = character.spells.slotsUsed ?? {};
  // Só níveis com espaços gastos e recuperáveis (1..5) entram — o servidor
  // recusa 6º+ e mais do que foi gasto.
  const levels = (character.derived.spellSlots ?? [])
    .filter((slot) => slot.level <= MAX_RECOVERABLE_LEVEL)
    .filter((slot) => (used[String(slot.level)] ?? 0) > 0)
    .map((slot) => slot.level);

  const spent = levels.reduce(
    (total, level) => total + level * (selection[String(level)] ?? 0),
    0,
  );
  const budgetLeft = option.budget - spent;

  function adjust(level: number, delta: number): void {
    setError(null);
    setSelection((current) => {
      const key = String(level);
      const currentCount = current[key] ?? 0;
      const maxUsed = used[key] ?? 0;
      const nextCount = Math.max(0, Math.min(maxUsed, currentCount + delta));
      // Não deixa o orçamento estourar (o servidor recusaria).
      if (delta > 0 && level * (nextCount - currentCount) > budgetLeft) return current;
      const next = { ...current };
      if (nextCount > 0) next[key] = nextCount;
      else delete next[key];
      return next;
    });
  }

  async function confirm(): Promise<void> {
    if (spent <= 0) {
      setError('Selecione ao menos um espaço para recuperar.');
      return;
    }
    const result = await onRecover(option.id, selection, character.version);
    if (result) {
      setSelection({});
      onApplied(result);
    }
  }

  return (
    <section className="recovery-card">
      <h3 className="subsection-title">{option.name}</h3>
      <p className="section-note">
        Recupere espaços gastos totalizando até <strong>{option.budget}</strong> níveis (metade do
        nível da classe, arredondado para cima). Nenhum espaço de 6º nível ou superior.
      </p>

      {levels.length === 0 ? (
        <p className="section-note">Você não tem espaços gastos que possam ser recuperados.</p>
      ) : (
        <ul className="recovery-levels">
          {levels.map((level) => {
            const key = String(level);
            const count = selection[key] ?? 0;
            const maxUsed = used[key] ?? 0;
            return (
              <li key={level}>
                <span className="recovery-level">{SPELL_LEVEL_LABELS[level]}</span>
                <span className="muted">gastos: {maxUsed}</span>
                <span className="recovery-stepper">
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={disabled || pending || count <= 0}
                    aria-label={`Recuperar menos espaços de ${level}º nível`}
                    onClick={() => adjust(level, -1)}
                  >
                    −
                  </button>
                  <strong aria-live="polite">{count}</strong>
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={disabled || pending || count >= maxUsed || budgetLeft < level}
                    aria-label={`Recuperar mais espaços de ${level}º nível`}
                    onClick={() => adjust(level, 1)}
                  >
                    +
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <p className="recovery-budget">
        Orçamento usado: <strong>{spent}</strong> / {option.budget}
      </p>

      {error ? <p className="form-error">{error}</p> : null}

      <div className="modal-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={disabled || pending || spent <= 0}
          onClick={() => void confirm()}
        >
          {pending ? 'recuperando…' : `Confirmar recuperação`}
        </button>
      </div>
    </section>
  );
}

/** Linhas legíveis de uma recuperação aplicada (para o resultado do descanso). */
export function recoverySummaryLines(result: RecoverSlotsResult): string[] {
  return result.slots.map(
    (slot) =>
      `${slot.count} espaço(s) de ${SPELL_LEVEL_LABELS[slot.level] ?? `${slot.level}º nível`}`,
  );
}
