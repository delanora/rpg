import { useEffect, useRef, useState } from 'react';
import { categoryLabel, rarityLabel } from '../../dnd';
import type { Character, Item } from '../../types';
import { Icon } from '../Icon';
import { Portrait } from '../Portrait';

/**
 * Limites do envio, iguais aos do servidor (`sendItemSchema`): o mestre não tem
 * teto cumulativo, mas cada entrega vai de 1 a 1.000.000 unidades.
 */
const MIN_QUANTITY = 1;
const MAX_QUANTITY = 1_000_000;

interface ItemDeliverPanelProps {
  item: Item;
  /**
   * Destinatários válidos — a MESMA lista que o painel já usava para enviar
   * itens (as fichas da mesa). Nenhuma permissão nova é inferida aqui.
   */
  characters: Character[];
  /** Entrega pelo fluxo existente (`POST /api/items/:id/send`). */
  onSend: (characterId: string, quantity: number) => Promise<void>;
  /** Sucesso: o pai fecha só este painel e deixa o aviso no modal aberto. */
  onDelivered: (message: string) => void;
  onCancel: () => void;
}

/**
 * Painel compacto de **entrega** do item, aberto pela ação "entregar" do modal.
 *
 * É o mesmo fluxo de concessão que já existia: o mestre escolhe o personagem e a
 * quantidade, e o item entra no inventário do jogador. Nada sai do catálogo e
 * nenhum outro inventário é tocado. O painel aparece DENTRO do modal (que
 * continua aberto), fecha sozinho no sucesso e só ele fecha no cancelamento.
 *
 * VISUAL: cabeçalho com o item ancorado à direita (sprite + nome + categoria),
 * e o corpo em dois blocos — quem recebe (select + card do personagem + a frase
 * do envio) e quanto (stepper) — no mesmo desenho do painel de moedas. Tudo
 * empilha em telas estreitas; nada aqui guarda rolagem própria.
 */
export function ItemDeliverPanel({
  item,
  characters,
  onSend,
  onDelivered,
  onCancel,
}: ItemDeliverPanelProps) {
  const [targetId, setTargetId] = useState(() => characters[0]?.id ?? '');
  const [quantity, setQuantity] = useState(MIN_QUANTITY);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  // Foco inicial no destinatário; Esc cancela só esta caixa (o modal do item
  // fica aberto).
  useEffect(() => {
    selectRef.current?.focus();

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !sending) onCancel();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel, sending]);

  const target = characters.find((character) => character.id === targetId) ?? null;
  const rarity = rarityLabel(item.rarity);

  function changeQuantity(delta: number): void {
    setQuantity((current) => Math.min(MAX_QUANTITY, Math.max(MIN_QUANTITY, current + delta)));
  }

  async function deliver(): Promise<void> {
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

  return (
    <section className="items-deliver" aria-label={`Entregar ${item.name}`}>
      <header className="items-deliver-head">
        <div className="items-deliver-heading">
          <h3 className="items-deliver-title">Entregar item</h3>
          <p className="items-deliver-sub">
            Envie uma cópia deste item para o inventário de um personagem.
          </p>
        </div>

        {/* O item entregue fica ancorado no cabeçalho: o mestre não perde de
            vista o que está saindo do catálogo. */}
        <div className="items-deliver-anchor">
          <Portrait src={item.imageUrl} alt={item.name} size="sm" icon="flask" zoomable={false} />
          <span className="items-deliver-anchor-info">
            <strong className="items-deliver-anchor-name">{item.name}</strong>
            <span className="items-deliver-anchor-meta">
              {categoryLabel(item.category)}
              {rarity ? ` · ${rarity}` : ''}
            </span>
          </span>
        </div>
      </header>

      {characters.length === 0 ? (
        <p className="empty-hint">Nenhum jogador com ficha ainda.</p>
      ) : (
        <div className="items-deliver-body">
          <div className="items-deliver-block">
            <h4 className="items-deliver-block-title">Destinatário</h4>

            <label className="field">
              <span>Jogador</span>
              <select
                ref={selectRef}
                value={targetId}
                aria-label="Jogador que vai receber o item"
                onChange={(event) => setTargetId(event.target.value)}
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

            <p className="items-deliver-hint">
              {target
                ? quantity > 1
                  ? `${quantity} unidades serão adicionadas ao inventário de ${target.name}.`
                  : `O item será adicionado ao inventário de ${target.name}.`
                : 'Escolha o jogador que vai receber o item.'}
            </p>
          </div>

          <div className="items-deliver-block is-qty">
            <h4 className="items-deliver-block-title">Quantidade</h4>

            <div className="items-stepper">
              <button
                type="button"
                className="items-stepper-btn"
                aria-label="Diminuir quantidade"
                disabled={sending || quantity <= MIN_QUANTITY}
                onClick={() => changeQuantity(-1)}
              >
                <Icon name="minus" size={14} />
              </button>
              <output className="items-stepper-value" aria-live="polite">
                {quantity}
              </output>
              <button
                type="button"
                className="items-stepper-btn"
                aria-label="Aumentar quantidade"
                disabled={sending || quantity >= MAX_QUANTITY}
                onClick={() => changeQuantity(1)}
              >
                <Icon name="plus" size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {error ? <p className="form-error">{error}</p> : null}

      <div className="items-deliver-actions">
        <button type="button" className="btn btn-small" onClick={onCancel} disabled={sending}>
          cancelar
        </button>
        <button
          type="button"
          className="btn btn-primary btn-small"
          disabled={sending || !target}
          onClick={() => void deliver()}
        >
          <Icon name="bag" size={14} /> {sending ? 'entregando...' : 'entregar'}
        </button>
      </div>
    </section>
  );
}
