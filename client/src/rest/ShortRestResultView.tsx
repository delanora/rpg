import type { Character, ShortRestCompletionDto, ShortRestRequestDto } from '../types';
import type { RecoverSlotsResult } from '../featuresApi';
import { RestoredResources } from './RestoredResources';
import { recoverySummaryLines } from './ShortRestRecovery';

/**
 * Resumo do Descanso Curto concluído.
 *
 * Os recursos restaurados saem da AUDITORIA do servidor (5.3E.2) — nomes de
 * classe e de raça, agrupados por origem — e nunca de uma mensagem genérica. A
 * Song of Rest só aparece quando existe uma rolagem REAL para este personagem:
 * nenhum dado é gerado aqui.
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
  // A sessão DESTA ficha carrega a auditoria do descanso (recursos restaurados
  // por origem + efeitos encerrados), sem inventar nada no cliente.
  const mySession = completion?.sessions.find((session) => session.characterId === character.id);
  // Efeitos encerrados pelo lifecycle NESTA pausa (5.3C/5.3D.2).
  const endedEffects = mySession?.activeEffectsEnded ?? [];

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

      {/* Recursos restaurados agrupados por ORIGEM (Classe/Raça), com os nomes
          reais do servidor — nunca um rótulo genérico. Se nada foi restaurado,
          o bloco some. */}
      <RestoredResources
        classResources={mySession?.classResourcesRestored}
        racialResources={mySession?.racialResourcesRestored}
      />

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
