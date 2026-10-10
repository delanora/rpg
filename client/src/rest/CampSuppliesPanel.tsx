import type { ReactElement } from 'react';
import { Icon } from '../components/Icon';
import type { Character, InventoryItem, LongRestCampSuppliesDto } from '../types';

/**
 * Recursos de Acampamento do Descanso Longo — mecânica OPCIONAL (homebrew
 * inspirado no fluxo de Baldur's Gate 3). NÃO é regra do PHB 2014 e a interface
 * nunca deve apresentá-la como regra oficial.
 *
 * 5.2.7A: a antiga lista com stepper virou um GRID de cartões, inspirado na
 * mochila do inventário. O grid mostra SÓ os itens do PERSONAGEM ATUAL
 * (categoria Recurso de Acampamento, `campSupply.enabled`) que estão
 * disponíveis — nunca o inventário inteiro, nunca o item de outro jogador
 * (a propriedade é do servidor: só o dono da contribuição pode alterá-la).
 *
 * Este painel é APRESENTAÇÃO + intenção. Required/contributed/consumed são
 * derivados pelo SERVIDOR; os `+`/`−` chamam a API de contribuição existente e a
 * UI só reflete o estado autoritativo devolvido (não há estado local paralelo).
 * O preço monetário do item NUNCA aparece aqui (é informação exclusiva do
 * mestre): o jogador vê nome, imagem, quantidade, valor por unidade, selecionado
 * e contribuição.
 *
 * EXCESSO continua permitido: o máximo por pilha é a quantidade realmente
 * disponível, mas o total do grupo pode ultrapassar o requisito — e o excesso é
 * consumido do mesmo jeito (não truncamos para o requisito).
 *
 * Contribuições ÓRFÃS (a pilha saiu do inventário ou deixou de ser recurso de
 * acampamento depois de reservada) ficam fora do grid, em "Contribuições
 * indisponíveis", com um botão de remoção: o servidor aceita `quantity = 0` sem
 * revalidar o item, e sem isto o jogador ficaria preso — a reserva órfã bloqueia
 * a conclusão do descanso.
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
  /** Ficha do PRÓPRIO jogador: habilita o grid de contribuição. */
  character?: Character;
  /** characterId → displayName (visão do MESTRE). */
  names?: Record<string, string>;
  disabled?: boolean;
  /** Pilha que está sendo gravada agora (loading contextual). */
  busyItemId?: string | null;
  /**
   * Intenção de contribuição (só para quem tem ficha própria). Ausente na visão
   * do MESTRE, que acompanha os pontos sem controles — sem `onChange` o grid não
   * é renderizado.
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

  const canContribute = Boolean(character && onChange);
  // Só os itens do PRÓPRIO personagem que são recurso de acampamento ATIVO e têm
  // quantidade disponível entram no grid.
  const eligibleItems = character
    ? character.inventory.filter((item) => item.campSupply?.enabled === true && item.quantity > 0)
    : [];
  const eligibleIds = new Set(eligibleItems.map((item) => item.id));

  /** Quantidade que ESTE personagem já reservou nesta pilha (estado do servidor). */
  const reservedOf = (inventoryItemId: string): number =>
    supplies.contributions.find(
      (contribution) =>
        contribution.characterId === character?.id &&
        contribution.inventoryItemId === inventoryItemId,
    )?.quantity ?? 0;

  /** Pontos do próprio jogador (soma do que ele já contribuiu). */
  const myPoints = character
    ? supplies.contributions
        .filter((contribution) => contribution.characterId === character.id)
        .reduce((total, contribution) => total + contribution.points, 0)
    : 0;

  // Contribuições do PRÓPRIO jogador sem pilha correspondente no grid: a pilha
  // saiu do inventário, zerou ou o item deixou de ser recurso. Só elas podem ser
  // removidas por aqui — a de outro personagem o servidor recusa.
  const orphanContributions = character
    ? supplies.contributions.filter(
        (contribution) =>
          contribution.characterId === character.id &&
          !eligibleIds.has(contribution.inventoryItemId),
      )
    : [];

  const percent =
    supplies.required > 0
      ? Math.min(100, Math.round((supplies.contributed / supplies.required) * 100))
      : 100;
  // Enquanto UMA pilha está salvando, os steppers ficam bloqueados (evita clique
  // duplo e resposta fora de ordem). O resto do painel não congela.
  const blockSteppers = disabled || busyItemId !== null;

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
          Grupo: {supplies.contributed} / {supplies.required} recursos
          {supplies.satisfied
            ? ' · Requisito atendido'
            : ` · Faltam: ${supplies.remaining}`}
        </p>
      </div>
      {supplies.satisfied && supplies.contributed > supplies.required ? (
        <p className="camp-supply-hint">
          O excesso também será consumido — os itens selecionados são reservados por inteiro.
        </p>
      ) : null}

      {/* --- Grid do próprio jogador -------------------------------------- */}
      {canContribute ? (
        <>
          <p className="camp-supply-totals">
            Sua contribuição: <strong>{myPoints}</strong> recurso{myPoints === 1 ? '' : 's'}
          </p>

          {eligibleItems.length === 0 ? (
            <p className="section-note">
              Você não tem itens marcados como <strong>Recurso de Acampamento</strong> na mochila.
            </p>
          ) : (
            <ul
              className="camp-supply-grid"
              aria-label="Seus recursos de acampamento disponíveis"
            >
              {eligibleItems.map((item) => {
                const value = item.campSupply?.value ?? 0;
                // Máximo reservável nesta pilha = a quantidade REAL do inventário
                // (a reserva não sai da pilha até a conclusão do descanso).
                const available = item.quantity;
                const reserved = reservedOf(item.id);
                const selected = reserved > 0;
                const busy = busyItemId === item.id;
                const atMax = reserved >= available;

                return (
                  <li
                    key={item.id}
                    className={`camp-supply-card${selected ? ' is-selected' : ''}${
                      busy ? ' is-busy' : ''
                    }`}
                    // Estado de seleção exposto de forma programática (além do texto
                    // "Selecionado" e dos controles rotulados) — não depende só de cor.
                    aria-label={
                      selected
                        ? `${item.name}: ${reserved} de ${available} selecionado(s)`
                        : `${item.name}: não selecionado`
                    }
                    // O primeiro clique no card seleciona 1 unidade (0 → 1). Os
                    // controles internos param a propagação para não disparar isto.
                    // Quem usa teclado/leitor de tela tem o botão "Selecionar" abaixo.
                    onClick={() => {
                      if (!selected && !blockSteppers) onChange?.(item.id, 1);
                    }}
                  >
                    <span className="camp-supply-card-sprite">
                      <SupplySprite item={item} />
                    </span>

                    <span className="camp-supply-card-name">{item.name}</span>

                    {selected ? (
                      <span className="camp-supply-selected-tag">✓ Selecionado</span>
                    ) : null}

                    <span className="camp-supply-card-facts">Disponível: {available}</span>
                    <span className="camp-supply-card-facts">
                      {value} recurso{value === 1 ? '' : 's'} por unidade
                    </span>

                    {selected ? (
                      <>
                        <span className="camp-supply-card-facts">Selecionado: {reserved}</span>
                        <span className="camp-supply-card-points">
                          Contribuição: {reserved * value}
                        </span>
                      </>
                    ) : null}

                    {busy ? <span className="muted">salvando…</span> : null}

                    {selected ? (
                      <div
                        className="camp-supply-card-actions"
                        role="group"
                        aria-label={`Quantidade de ${item.name} para o acampamento`}
                      >
                        <button
                          type="button"
                          className="btn btn-small stepper-btn"
                          disabled={blockSteppers}
                          aria-label={`Devolver uma unidade de ${item.name}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onChange?.(item.id, reserved - 1);
                          }}
                        >
                          −
                        </button>
                        <span className="stepper-value" aria-live="polite">
                          {reserved}
                        </span>
                        <button
                          type="button"
                          className="btn btn-small stepper-btn"
                          disabled={blockSteppers || atMax}
                          aria-label={`Reservar mais uma unidade de ${item.name}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onChange?.(item.id, reserved + 1);
                          }}
                        >
                          +
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-small"
                        disabled={blockSteppers}
                        aria-label={`Selecionar 1 unidade de ${item.name} para o acampamento`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onChange?.(item.id, 1);
                        }}
                      >
                        Selecionar
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* Contribuições órfãs: destravam o descanso sem exigir abort. */}
          {orphanContributions.length > 0 ? (
            <>
              <h5 className="camp-supply-orphan-title">Contribuições indisponíveis</h5>
              <ul className="camp-supply-grid camp-supply-grid-orphans">
                {orphanContributions.map((contribution) => {
                  const busy = busyItemId === contribution.inventoryItemId;
                  return (
                    <li
                      className={`camp-supply-card is-orphan${busy ? ' is-busy' : ''}`}
                      key={contribution.inventoryItemId}
                    >
                      <span className="camp-supply-card-sprite">
                        <Icon name="bag" size={22} />
                      </span>
                      <span className="camp-supply-card-name">Item fora do inventário</span>
                      <span className="camp-supply-card-facts">
                        Reserva de {contribution.quantity} unidade(s) · {contribution.points}{' '}
                        ponto(s)
                      </span>
                      <span className="camp-supply-card-facts">
                        A pilha não está mais disponível na sua mochila.
                      </span>
                      {busy ? <span className="muted">removendo…</span> : null}
                      <button
                        type="button"
                        className="btn btn-small"
                        disabled={blockSteppers}
                        onClick={() => onChange?.(contribution.inventoryItemId, 0)}
                      >
                        Remover contribuição
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </>
      ) : null}

      {/* --- Visão do MESTRE: contribuições, sem assumir o controle -------- */}
      {!canContribute && names && supplies.byCharacter.length > 0 ? (
        <>
          <ul className="camp-supply-by-character">
            {supplies.byCharacter.map((entry) => (
              <li key={entry.characterId}>
                <span>{names[entry.characterId] ?? 'Personagem'}</span>
                <strong>
                  {entry.points} recurso{entry.points === 1 ? '' : 's'}
                </strong>
              </li>
            ))}
          </ul>
          <p className="camp-supply-totals">
            Total: <strong>{supplies.contributed}</strong> / {supplies.required} recursos
            {supplies.satisfied ? '' : ` · Faltam: ${supplies.remaining}`}
          </p>
        </>
      ) : null}
    </div>
  );
}

/**
 * Sprite do item com fallback coerente (mesmo ícone do inventário quando não há
 * imagem). Próprio deste grid para não acoplar ao `InventorySection`.
 */
function SupplySprite({ item }: { item: InventoryItem }): ReactElement {
  if (item.imageUrl) {
    return (
      <img
        className="camp-supply-card-sprite-img"
        src={item.imageUrl}
        alt=""
        draggable={false}
      />
    );
  }
  return <Icon name="flask" size={24} />;
}
