import { useEffect, useRef, useState } from 'react';
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
      <div className="items-deliver-head">
        <Portrait src={item.imageUrl} alt={item.name} size="sm" icon="flask" zoomable={false} />
        <h3 className="items-deliver-title">Entregar item</h3>
        <span className="items-deliver-item">{item.name}</span>
      </div>

      {characters.length === 0 ? (
        <p className="empty-hint">Nenhum jogador com ficha ainda.</p>
      ) : (
        <div className="items-deliver-fields">
          <label className="field items-deliver-field">
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

          <div className="field items-deliver-field items-deliver-qty">
            <span>Quantidade</span>
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

      <p className="items-deliver-hint">
        {target
          ? quantity > 1
            ? `${quantity} unidades serão adicionadas ao inventário de ${target.name}.`
            : `O item será adicionado ao inventário de ${target.name}.`
          : 'Escolha o jogador que vai receber o item.'}
      </p>

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
