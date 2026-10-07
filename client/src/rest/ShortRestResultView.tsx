import type { Character, ShortRestCompletionDto, ShortRestRequestDto } from '../types';

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
  onClose,
}: {
  request: ShortRestRequestDto;
  completion: ShortRestCompletionDto | null;
  character: Character;
  onClose: () => void;
}) {
  const me = request.participants.find((participant) => participant.characterId === character.id);
  const accepted = me?.response === 'ACCEPTED';
  const roll = completion?.songOfRest.rolls.find(
    (entry) => entry.characterId === character.id,
  );
  const songDie = completion?.songOfRest.die ?? null;
  const hpMax = character.derived.hpMax;

  return (
    <div className="short-rest-result">
      <p className="short-rest-lead">A pausa terminou — você recuperou forças.</p>

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
