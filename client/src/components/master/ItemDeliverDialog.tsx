import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { categoryLabel, rarityColor, rarityLabel, rarityTint } from '../../dnd';
import type { Character, Item } from '../../types';
import { Icon } from '../Icon';
import { Portrait } from '../Portrait';

/**
 * Limites do envio, iguais aos do servidor (`sendItemSchema`): o mestre não tem
 * teto cumulativo, mas cada entrega vai de 1 a 1.000.000 unidades.
 */
const MIN_QUANTITY = 1;
const MAX_QUANTITY = 1_000_000;

interface ItemDeliverDialogProps {
  item: Item;
  /**
   * Destinatários válidos — a MESMA lista que o painel já usava para enviar
   * itens (as fichas da mesa). Nenhuma permissão nova é inferida aqui.
   */
  characters: Character[];
  /** Entrega pelo fluxo existente (`POST /api/items/:id/send`). */
  onSend: (characterId: string, quantity: number) => Promise<void>;
  /** Sucesso: o pai fecha esta janela e deixa o aviso no modal do item. */
  onDelivered: (message: string) => void;
  onCancel: () => void;
}

interface ItemDeliverCardProps {
  item: Item;
  characters: Character[];
  /** Personagem escolhido no select (o primeiro, por padrão). */
  targetId: string;
  quantity: number;
  sending: boolean;
  error: string | null;
  /** Cartão que recebe o foco quando a mesa ainda não tem ficha. */
  cardRef?: RefObject<HTMLDivElement | null>;
  onTargetChange: (id: string) => void;
  onQuantityChange: (delta: number) => void;
  onCancel: () => void;
  onDeliver: () => void;
}

/**
 * Conteúdo da janela de entrega — **só apresentação**: o estado e a chamada de
 * envio ficam no `ItemDeliverDialog`, o que deixa este cartão montável sem
 * portal (é assim que ele é conferido em SSR).
 *
 * Composição: cabeçalho (título, subtítulo e o X de fechar), corpo em duas
 * colunas — o card do item à esquerda (só resumo visual: arte, nome inteiro,
 * categoria e raridade) e o painel de formulário à direita (jogador, resumo do
 * personagem, quantidade e a frase do envio) — e o rodapé de ações de largura
 * total. Duas áreas e meia: nada de card dentro de card, e nada da ficha do
 * item (atributos, descrição, peso, preço) aqui.
 */
export function ItemDeliverCard({
  item,
  characters,
  targetId,
  quantity,
  sending,
  error,
  cardRef,
  onTargetChange,
  onQuantityChange,
  onCancel,
  onDeliver,
}: ItemDeliverCardProps) {
  const target = characters.find((character) => character.id === targetId) ?? null;
  const rarity = rarityLabel(item.rarity);
  const rarityAccent = rarityTint(item.rarity, '99');
  const rarityInk = rarityColor(item.rarity);

  return (
    <div
      ref={cardRef}
      className="modal items-deliver-dialog"
      tabIndex={-1}
      onClick={(event) => event.stopPropagation()}
    >
      <header className="items-deliver-head">
        <div className="items-deliver-heading">
          <h2 className="items-deliver-title">Entregar item</h2>
          <p className="items-deliver-sub">
            Envie uma cópia deste item para o inventário de um personagem.
          </p>
        </div>
        <button
          type="button"
          className="items-deliver-close"
          aria-label="Fechar entrega"
          disabled={sending}
          onClick={onCancel}
        >
          <Icon name="x" size={16} />
        </button>
      </header>

      <div className="items-deliver-body">
        {/* Coluna esquerda: resumo do item. A ficha completa continua no modal
            atrás desta janela. */}
        <article className="items-deliver-item-card">
          {item.imageUrl ? (
            <img className="items-deliver-art" src={item.imageUrl} alt={item.name} />
          ) : (
            <span className="items-deliver-art is-empty" aria-hidden="true">
              <Icon name="flask" size={44} />
            </span>
          )}

          <h3 className="items-deliver-item-name">{item.name}</h3>

          <p className="items-deliver-item-tags">
            <span className="item-modal-tag">{categoryLabel(item.category)}</span>
            {rarity ? (
              <span
                className="item-modal-tag is-rarity"
                style={
                  rarityInk && rarityAccent
                    ? { color: rarityInk, borderColor: rarityAccent }
                    : undefined
                }
              >
                {rarity}
              </span>
            ) : null}
            {item.requiresAttunement ? (
              <span className="item-modal-tag is-attunement">Requer Sintonização</span>
            ) : null}
          </p>
        </article>

        {/* Sem ninguém para receber, o painel de formulário não aparece: o que
            fica é o aviso de mesa vazia (abaixo), como antes. */}
        {characters.length > 0 ? (
          <div className="items-deliver-form">
            <label className="field">
              <span>Jogador</span>
              <select
                value={targetId}
                autoFocus
                aria-label="Jogador que vai receber o item"
                onChange={(event) => onTargetChange(event.target.value)}
              >
                {characters.map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.name}
                    {character.ownerUsername ? ` (${character.ownerUsername})` : ''}
                  </option>
                ))}
              </select>
            </label>

            {target ? (
              <div className="items-deliver-target">
                <Portrait
                  src={target.avatarUrl}
                  alt={target.name}
                  size="sm"
                  icon="users"
                  zoomable={false}
                />
                <span className="items-deliver-target-info">
                  <strong>{target.name}</strong>
                  <span className="items-deliver-target-owner">
                    {target.ownerUsername ?? 'sem conta vinculada'}
                  </span>
                </span>
              </div>
            ) : null}

            <div className="field">
              <span>Quantidade</span>
              <div className="items-stepper">
                <button
                  type="button"
                  className="items-stepper-btn"
                  aria-label="Diminuir quantidade"
                  disabled={sending || quantity <= MIN_QUANTITY}
                  onClick={() => onQuantityChange(-1)}
                >
                  <Icon name="minus" size={16} />
                </button>
                <output className="items-stepper-value" aria-live="polite">
                  {quantity}
                </output>
                <button
                  type="button"
                  className="items-stepper-btn"
                  aria-label="Aumentar quantidade"
                  disabled={sending || quantity >= MAX_QUANTITY}
                  onClick={() => onQuantityChange(1)}
                >
                  <Icon name="plus" size={16} />
                </button>
              </div>
            </div>

            <p className="items-deliver-hint">
              <Icon name="info" size={13} />
              <span>
                {target
                  ? quantity > 1
                    ? `${quantity} unidades serão adicionadas ao inventário de ${target.name}.`
                    : `O item será adicionado ao inventário de ${target.name}.`
                  : 'Escolha o jogador que vai receber o item.'}
              </span>
            </p>
          </div>
        ) : null}
      </div>

      {characters.length === 0 ? (
        <p className="empty-hint">Nenhum jogador com ficha ainda.</p>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}

      <footer className="items-deliver-actions">
        <button type="button" className="btn" onClick={onCancel} disabled={sending}>
          cancelar
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={sending || !target}
          onClick={onDeliver}
        >
          <Icon name="bag" size={14} /> {sending ? 'entregando...' : 'entregar'}
        </button>
      </footer>
    </div>
  );
}

/**
 * Janela de **entrega** do item, aberta pela ação "entregar" do modal do item.
 *
 * É o mesmo fluxo de concessão que já existia: o mestre escolhe o personagem e a
 * quantidade, e o item entra no inventário do jogador. Nada sai do catálogo e
 * nenhum outro inventário é tocado.
 *
 * SOBREPOSIÇÃO: a entrega é um **modal próprio por cima do modal do item** —
 * não um bloco dentro dele. O modal de baixo continua visível, mas o pai o deixa
 * `inert` (sem mouse, sem Tab e fora do leitor de tela) enquanto esta janela
 * estiver aberta, e o Esc daqui fecha SÓ a entrega: o Esc do modal de baixo é
 * ignorado pelo pai enquanto ela está no ar. Como qualquer modal do app, é
 * montada por portal no `<body>`; o `is-deliver` a põe na mesma faixa das
 * confirmações (acima dos modais, abaixo do lightbox), para que o véu escurecido
 * cubra o modal do item.
 */
export function ItemDeliverDialog({
  item,
  characters,
  onSend,
  onDelivered,
  onCancel,
}: ItemDeliverDialogProps) {
  const [targetId, setTargetId] = useState(() => characters[0]?.id ?? '');
  const [quantity, setQuantity] = useState(MIN_QUANTITY);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Esc cancela — nunca confirma — e só fecha esta janela; com o envio em
  // andamento, nem isso.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !sending) onCancel();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel, sending]);

  // Sem mesa (nenhum select para receber o foco), o foco entra no próprio
  // cartão; com o select presente, o `autoFocus` dele já resolveu antes daqui.
  useEffect(() => {
    const card = cardRef.current;
    if (card && !card.contains(document.activeElement)) card.focus();
  }, []);

  function changeQuantity(delta: number): void {
    setQuantity((current) => Math.min(MAX_QUANTITY, Math.max(MIN_QUANTITY, current + delta)));
  }

  async function deliver(): Promise<void> {
    const target = characters.find((character) => character.id === targetId) ?? null;
    if (!target || sending) return;
    setSending(true);
    setError(null);

    try {
      await onSend(target.id, quantity);
      onDelivered(
        quantity > 1
          ? `${quantity}× ${item.name} entregues a ${target.name}.`
          : `${item.name} entregue a ${target.name}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao entregar o item.');
    } finally {
      setSending(false);
    }
  }

  return createPortal(
    <div
      className="modal-backdrop is-deliver"
      role="dialog"
      aria-modal="true"
      aria-label={`Entregar ${item.name}`}
      // Clicar fora cancela SÓ a entrega (o modal do item continua aberto).
      onClick={() => {
        if (!sending) onCancel();
      }}
    >
      <ItemDeliverCard
        item={item}
        characters={characters}
        targetId={targetId}
        quantity={quantity}
        sending={sending}
        error={error}
        cardRef={cardRef}
        onTargetChange={setTargetId}
        onQuantityChange={changeQuantity}
        onCancel={onCancel}
        onDeliver={() => void deliver()}
      />
    </div>,
    document.body,
  );
}
