import type { ReactElement } from 'react';
import type {
  Character,
  LongRestCompletionDto,
  LongRestConsumedCampSupplyDto,
  LongRestRequestDto,
} from '../types';

/**
 * Resumo do Descanso Longo concluído (PASSO 40).
 *
 * O cliente NÃO inventa benefícios: tudo sai da auditoria da conclusão
 * (`completion`), que o servidor monta ao aplicar as regras. A lista mostra
 * APENAS o que realmente mudou (PASSO 41) — nada de "Magia de Pacto restaurada"
 * para quem não tem Pact Magic nem "Dados de Vida recuperados: 0".
 *
 * A `overrideNote` do mestre só aparece na visão do MESTRE (PASSO 43): o
 * jogador recebe só o aviso de que a mesa resolveu a falta de recursos. E quem
 * recusou o convite nunca aparece como beneficiado (PASSO 44).
 *
 * Os RECURSOS DE ACAMPAMENTO consumidos aparecem por PERSONAGEM, em cima da
 * auditoria da conclusão (`suppliesConsumed`): o jogador vê o que saiu da
 * PRÓPRIA mochila (nome do item, quantas unidades e de quanto para quanto a
 * pilha ficou) e o Mestre vê o de cada participante. O nome e as quantidades
 * vêm do servidor justamente para não depender do que a tela mostrava antes.
 */
export function LongRestResultView({
  request,
  completion,
  character,
  myCharacterId,
  isMaster = false,
  onClose,
}: {
  request: LongRestRequestDto;
  completion: LongRestCompletionDto | null;
  character?: Character;
  myCharacterId?: string;
  isMaster?: boolean;
  onClose: () => void;
}): ReactElement {
  const entries = completion
    ? isMaster
      ? completion.characters
      : completion.characters.filter((entry) => entry.characterId === myCharacterId)
    : [];

  /** Pilhas que saíram da mochila DESTE personagem (auditoria do servidor). */
  const consumedByCharacter = (characterId: string): LongRestConsumedCampSupplyDto[] =>
    (completion?.suppliesConsumed ?? []).filter((supply) => supply.characterId === characterId);

  const declined = request.participants.filter((participant) => participant.response === 'DECLINED');

  return (
    <div className="long-rest-result-view">
      <div className="rest-result-head">
        <p className="rest-result-title">✓ Descanso concluído</p>
        <p className="rest-result-lead">O grupo recuperou as forças.</p>
      </div>

      {!completion ? (
        <>
          <p className="section-note">Os benefícios já foram aplicados às fichas dos participantes.</p>
          {request.campSupplies.enabled ? (
            <p className="result-secondary">
              Recursos de Acampamento: {request.campSupplies.contributed} de{' '}
              {request.campSupplies.required} pontos.
            </p>
          ) : null}
        </>
      ) : null}

      {entries.map((entry) => {
        const recovered = entry.hitDiceRecovered.filter((die) => die.count > 0);
        const levels = [...entry.spellSlotLevelsRestored].sort((a, b) => a - b);
        const hasPact = !isMaster && Boolean(character?.derived?.pactSlots);
        const hasRows =
          entry.hpAfter !== entry.hpBefore ||
          recovered.length > 0 ||
          levels.length > 0 ||
          hasPact ||
          entry.classResourcesRestored.length > 0 ||
          entry.racialUsesRestored.length > 0 ||
          entry.activeTogglesCleared.length > 0;

        const consumed = consumedByCharacter(entry.characterId);

        return (
          <div className="long-rest-result" key={entry.characterId}>
            <h3 className="subsection-title">{isMaster ? entry.username : character?.name ?? entry.username}</h3>

            {hasRows ? (
              <ul className="result-facts">
                {entry.hpAfter !== entry.hpBefore ? (
                  <li>
                    <span>Pontos de vida</span>
                    <strong>
                      {entry.hpBefore} → {entry.hpAfter}
                    </strong>
                  </li>
                ) : null}

                {recovered.length > 0 ? (
                  <li>
                    <span>Dados de Vida recuperados</span>
                    <strong>
                      {recovered
                        .map((die) => (die.count === 1 ? `1d${die.die}` : `${die.count}d${die.die}`))
                        .join(' + ')}
                    </strong>
                  </li>
                ) : null}

                {levels.length > 0 ? (
                  <li>
                    <span>Espaços de magia</span>
                    <strong>restaurados (níveis {levels.join(', ')})</strong>
                  </li>
                ) : null}

                {hasPact ? (
                  <li>
                    <span>Magia de Pacto</span>
                    <strong>restaurada</strong>
                  </li>
                ) : null}

                {entry.classResourcesRestored.length > 0 ? (
                  <li>
                    <span>Recursos de classe</span>
                    <strong>restaurados</strong>
                  </li>
                ) : null}

                {entry.racialUsesRestored.length > 0 ? (
                  <li>
                    <span>Usos de magias raciais</span>
                    <strong>restaurados</strong>
                  </li>
                ) : null}

                {entry.activeTogglesCleared.length > 0 ? (
                  <li>
                    <span>Efeitos ativos</span>
                    <strong>encerrados</strong>
                  </li>
                ) : null}
              </ul>
            ) : (
              <p className="section-note">Nada a recuperar nesta ficha — já estava tudo em dia.</p>
            )}

            {/* Recursos de Acampamento que saíram da mochila deste personagem. */}
            {consumed.length > 0 ? (
              <>
                <p className="result-note">Saiu da mochila no acampamento:</p>
                <ul className="result-facts">
                  {consumed.map((supply) => (
                    <li key={supply.inventoryItemId}>
                      <span>{supply.name ?? 'Recurso de acampamento'}</span>
                      <strong>{describeConsumedSupply(supply)}</strong>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        );
      })}

      {completion?.campSupplies.enabled ? (
        <div className="result-secondary">
          <p>
            <span>Recursos de Acampamento</span>{' '}
            <strong>{completion.campSupplies.consumedPoints} consumidos</strong>
          </p>
          {completion.campSupplies.overridden ? (
            <p className="result-note">
              {completion.campSupplies.overrideType === 'ADMINISTRATIVE'
                ? 'Conclusão autorizada pelo Mestre.'
                : 'Exceção narrativa concedida pelo Mestre.'}
            </p>
          ) : completion.campSupplies.consumedPoints > completion.campSupplies.required ? (
            <p className="muted">
              {completion.campSupplies.consumedPoints} consumidos ·{' '}
              {completion.campSupplies.required} necessários.
            </p>
          ) : null}
        </div>
      ) : null}

      {isMaster && completion?.campSupplies.overrideNote ? (
        <p className="result-note">Observação: {completion.campSupplies.overrideNote}</p>
      ) : null}

      {declined.length > 0 ? (
        <p className="section-note">
          Não participaram deste descanso: {declined.map((participant) => participant.displayName).join(', ')}.
        </p>
      ) : null}

      <div className="modal-actions">
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Fechar
        </button>
      </div>
    </div>
  );
}

/**
 * Descreve UMA pilha consumida: quantidade + o efeito na mochila.
 *
 * `quantityBefore`/`quantityAfter` são opcionais (conclusões antigas não os
 * têm): sem eles, mostramos só a quantidade consumida.
 */
function describeConsumedSupply(supply: LongRestConsumedCampSupplyDto): string {
  const units = supply.quantity === 1 ? '1 unidade' : `${supply.quantity} unidades`;
  if (supply.quantityAfter === 0) return `${units} · saiu do inventário`;
  if (supply.quantityBefore !== undefined && supply.quantityAfter !== undefined) {
    return `${units} · ${supply.quantityBefore} → ${supply.quantityAfter}`;
  }
  return units;
}
