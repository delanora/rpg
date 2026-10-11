import type { Character, ShortRestCompletionDto, ShortRestRequestDto } from '../types';
import type { RecoverSlotsResult } from '../featuresApi';
import { recoverySummaryLines } from './ShortRestRecovery';

/**
 * Resumo do Descanso Curto concluído.
 *
 * A lista de recursos recuperados NÃO é inventada pelo cliente: o backend
 * restaura as recargas curtas, mas não devolve o diff, então mostramos a
 * mensagem genérica (Passo 22). A Song of Rest só aparece quando existe uma
 * rolagem REAL para este personagem — nenhum dado é gerado aqui.
 */
export function ShortRestResultView({
  request,
  completion,
  character,
  recovery,
  onClose,
}: {
  request: ShortRestRequestDto;
  completion: ShortRestCompletionDto | null;
  character: Character;
  /** Recuperação especial aplicada nesta pausa (Arcane/Natural); null se não usou. */
  recovery?: RecoverSlotsResult | null;
  onClose: () => void;
}) {
  const me = request.participants.find((participant) => participant.characterId === character.id);
  const accepted = me?.response === 'ACCEPTED';
  const roll = completion?.songOfRest.rolls.find(
    (entry) => entry.characterId === character.id,
  );
  const songDie = completion?.songOfRest.die ?? null;
  const hpMax = character.derived.hpMax;
  // Efeitos encerrados pelo lifecycle NESTA pausa (5.3D.2) — só os desta ficha.
  const endedEffects =
    completion?.sessions.find((session) => session.characterId === character.id)
      ?.activeEffectsEnded ?? [];

  return (
    <div className="short-rest-result">
      <div className="rest-result-head">
        <p className="rest-result-title">✓ Pausa concluída</p>
        <p className="rest-result-lead">Você recuperou forças.</p>
      </div>

      <div className="short-rest-stat">
        <span className="short-rest-stat-label">Pontos de vida</span>
        <span className="short-rest-stat-value">
          {character.hpCurrent} / {hpMax}
        </span>
      </div>

      <h3 className="subsection-title">Recursos recuperados</h3>
      <p className="section-note">
        Recursos de Descanso Curto recuperados automaticamente pelo servidor.
      </p>

      {/* Recuperação especial só aparece quando houve recuperação REAL — nunca
          uma linha falsa. */}
      {recovery && recovery.slots.length > 0 ? (
        <>
          <h3 className="subsection-title">{recovery.featureName}</h3>
          <ul className="short-rest-summary">
            {recoverySummaryLines(recovery).map((line) => (
              <li key={line}>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {endedEffects.length > 0 ? (
        <>
          <h3 className="subsection-title">Efeitos encerrados</h3>
          <ul className="short-rest-summary">
            {endedEffects.map((effect) => (
              <li key={effect.id}>
                <span>{effect.name}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h3 className="subsection-title">Canção de Descanso</h3>
      {roll ? (
        <p className="short-rest-song">
          <strong>1d{roll.die}</strong> [{roll.value}] → <strong>+{roll.actualHealed} PV</strong>
          {roll.value > roll.actualHealed ? (
            <span className="muted">
              {' '}
              (o excedente de {roll.value - roll.actualHealed} PV foi ignorado pelo máximo)
            </span>
          ) : null}
        </p>
      ) : accepted && songDie !== null ? (
        <p className="section-note">
          Canção de Descanso disponível (d{songDie}), mas nenhum Dado de Vida foi gasto.
        </p>
      ) : (
        <p className="section-note">Nenhuma Canção de Descanso nesta pausa.</p>
      )}

      <div className="modal-actions">
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Fechar
        </button>
      </div>
    </div>
  );
}
