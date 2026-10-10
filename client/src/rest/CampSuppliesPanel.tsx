import type { ReactElement } from 'react';
import type { Character, LongRestCampSuppliesDto } from '../types';

/**
 * Recursos de Acampamento do Descanso Longo — mecânica OPCIONAL (homebrew
 * inspirado no fluxo de Baldur's Gate 3). NÃO é regra do PHB 2014 e a interface
 * nunca deve apresentá-la como regra oficial.
 *
 * Este painel é só APRESENTAÇÃO + intenção: os pontos exigidos, contribuídos e
 * consumidos são derivados pelo servidor (PASSO 17). A barra de progresso mostra
 * requerido/contribuído/faltando, inclusive o EXCESSO (PASSO 20) — o excesso não
 * é escondido, porque os itens reservados são consumidos do mesmo jeito.
 *
 * Desligada, a mecânica não exige, reserva nem consome nada (PASSO 15): as
 * contribuições antigas continuam visíveis como histórico, nunca como bloqueio.
 *
 * Contribuições ÓRFÃS (a pilha saiu do inventário ou deixou de ser recurso de
 * acampamento depois de reservada) ganham a própria linha com um botão de
 * remoção: o servidor aceita `quantity = 0` sem revalidar o item, e sem isto o
 * jogador ficaria preso — a reserva órfã bloqueia a conclusão do descanso.
 */
export function CampSuppliesPanel({
  supplies,
  character,
  names,
  disabled = false,
  busyItemId = null,
  onChange,
}: {

  supplies: LongRestCampSuppliesDto;
  /** Ficha do PRÓPRIO jogador: habilita os controles de contribuição. */
  character?: Character;
  /** characterId → displayName (visão do MESTRE). */
  names?: Record<string, string>;
  disabled?: boolean;
  /** Pilha que está sendo gravada agora (loading contextual). */
  busyItemId?: string | null;
  /**
   * Intenção de contribuição (só para quem tem ficha própria). Ausente na visão
   * do MESTRE, que acompanha os pontos sem controles — sem `onChange` os
   * steppers simplesmente não são renderizados.
   */
  onChange?: (inventoryItemId: string, quantity: number) => void;
}): ReactElement | null {
  // --- Mecânica desligada: nada bloqueia, nada é consumido ------------------
  if (!supplies.enabled) {
    const historicPoints = supplies.contributions.reduce(
      (total, contribution) => total + contribution.points,
      0,
    );
    return (
      <div className="camp-supply is-off">
        <h4>Recursos de Acampamento desativados</h4>
        <p className="section-note">
          A mecânica opcional está desligada: nenhum recurso é exigido, reservado ou consumido
          neste descanso.
        </p>
        {supplies.contributions.length > 0 ? (
          <p className="section-note">
            Contribuições registradas antes de desligar: {historicPoints} ponto(s) — não serão
            consumidas enquanto a mecânica estiver desativada.
          </p>
        ) : null}
      </div>
    );
  }

  const percent =
    supplies.required > 0
      ? Math.min(100, Math.round((supplies.contributed / supplies.required) * 100))
      : 100;
  const eligibleItems = character
    ? character.inventory.filter(
        (item) => item.campSupply?.enabled === true && item.quantity > 0,
      )
    : [];
  // Contribuições do PRÓPRIO jogador que não têm mais linha de stepper (a pilha
  // saiu do inventário, zerou ou deixou de ser recurso). Só elas podem ser
  // removidas por aqui — a de outro personagem o servidor recusa
  // (CONTRIBUTION_NOT_YOURS).
  const eligibleIds = new Set(eligibleItems.map((item) => item.id));
  const orphanContributions = character
    ? supplies.contributions.filter(
        (contribution) =>
          contribution.characterId === character.id &&
          !eligibleIds.has(contribution.inventoryItemId),
      )
    : [];

  return (
    <div className="camp-supply">
      <div className="camp-supply-head">
        <h4>Recursos de Acampamento</h4>
        <span className="camp-supply-badge">Regra opcional</span>
      </div>

      {/* Progresso coletivo: mostramos o número cru, inclusive o excesso. */}
      <div className="camp-supply-progress">
        <div className="camp-supply-bar">
          <div className="camp-supply-bar-fill" style={{ width: `${percent}%` }} />
        </div>
        <p className="camp-supply-numbers">
          {supplies.contributed} / {supplies.required}
        </p>
      </div>
      <p className="camp-supply-hint">
        {supplies.satisfied
          ? supplies.contributed > supplies.required
            ? 'Quantidade necessária atingida (o excesso também será consumido).'
            : 'Quantidade necessária atingida.'
          : `Faltam ${supplies.remaining} ponto(s).`}
      </p>

      {/* Contribuições do PRÓPRIO jogador (o mestre acompanha sem esta lista). */}
      {character && onChange ? (
        eligibleItems.length === 0 ? (
          <p className="section-note">
            Você não tem itens marcados como recurso de acampamento na ficha.
          </p>
        ) : (
          <ul className="camp-supply-items">
            {eligibleItems.map((item) => {
              const value = item.campSupply?.value ?? 0;
              const reserved =
                supplies.contributions.find(
                  (contribution) =>
                    contribution.characterId === character.id &&
                    contribution.inventoryItemId === item.id,
                )?.quantity ?? 0;
              const busy = busyItemId === item.id;

              return (
                <li className={busy ? 'camp-supply-item is-busy' : 'camp-supply-item'} key={item.id}>
                  <div className="camp-supply-item-head">
                    <span className="camp-supply-item-name">{item.name}</span>
                    {busy ? <span className="muted">salvando…</span> : null}
                  </div>

                  <span className="camp-supply-item-facts">
                    {item.quantity} disponíveis · {value} pontos cada
                  </span>

                  {reserved > 0 ? (
                    <span className="camp-supply-item-reserved">
                      Possui: {item.quantity} · Reservado para descanso: {reserved} · Disponível:{' '}
                      {item.quantity - reserved}
                    </span>
                  ) : null}

                  <div className="camp-supply-actions">
                    <button
                      type="button"
                      className="btn btn-small stepper-btn"
                      disabled={disabled || busyItemId !== null || reserved <= 0}
                      aria-label={`Devolver uma unidade de ${item.name}`}
                      onClick={() => onChange(item.id, reserved - 1)}
                    >
                      −
                    </button>
                    <span className="stepper-value" aria-live="polite">
                      {reserved}
                    </span>
                    <button
                      type="button"
                      className="btn btn-small stepper-btn"
                      disabled={disabled || busyItemId !== null || reserved >= item.quantity}
                      aria-label={`Reservar uma unidade de ${item.name}`}
                      onClick={() => onChange(item.id, reserved + 1)}
                    >
                      +
                    </button>
                  </div>

                  <span className="camp-supply-item-points">
                    Contribuição: {reserved * value} pontos
                  </span>
                </li>
              );
            })}
          </ul>
        )
      ) : null}

      {/* Contribuições órfãs: destravam o descanso sem exigir abort (PASSO 14). */}
      {character && onChange && orphanContributions.length > 0 ? (
        <ul className="camp-supply-items">
          {orphanContributions.map((contribution) => {
            const busy = busyItemId === contribution.inventoryItemId;
            return (
              <li
                className={busy ? 'camp-supply-item is-busy' : 'camp-supply-item'}
                key={contribution.inventoryItemId}
              >
                <div className="camp-supply-item-head">
                  <span className="camp-supply-item-name">Item fora do inventário</span>
                  {busy ? <span className="muted">removendo…</span> : null}
                </div>

                <span className="camp-supply-item-facts">
                  Reserva de {contribution.quantity} unidade(s) · {contribution.points} ponto(s) —
                  a pilha não está mais disponível na sua ficha.
                </span>

                <div className="camp-supply-actions">
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={disabled || busyItemId !== null}
                    onClick={() => onChange(contribution.inventoryItemId, 0)}
                  >
                    Remover contribuição
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* Quebra de pontos por personagem (visão do mestre). */}
      {names && supplies.byCharacter.length > 0 ? (
        <ul className="camp-supply-by-character">
          {supplies.byCharacter.map((entry) => (
            <li key={entry.characterId}>
              <span>{names[entry.characterId] ?? 'Personagem'}</span>
              <strong>{entry.points} ponto(s)</strong>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
