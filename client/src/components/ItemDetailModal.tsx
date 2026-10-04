import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { itemDetailRows, rarityColor, rarityLabel, rarityTint } from '../dnd';
import type { InventoryItem } from '../types';
import { clampInt } from '../utils';
import { Icon } from './Icon';
import { InlineField } from './InlineField';
import { useLightbox } from './Lightbox';

interface ItemDetailModalProps {
  item: InventoryItem;
  onClose: () => void;
  /**
   * Usa (consome) 1 unidade do item. Quando ausente, o modal é só leitura (a
   * visão do mestre, por exemplo, não usa itens).
   */
  onUse?: () => void | Promise<void>;
  /**
   * Quantidade editável. Só o mestre a recebe (o jogador nunca altera a
   * quantidade). Ausente = quantidade somente leitura.
   */
  onQuantityChange?: (quantity: number) => void;
  /** Permite remover o item do inventário. Só o mestre recebe. */
  onRemove?: () => void;
}

/**
 * Ficha detalhada de um item do inventário, aberta no clique.
 *
 * Mostra os dados que já estão no item (nunca copia nem altera o inventário). O
 * campo **Valor** nunca aparece aqui — o preço é informação exclusiva do mestre
 * e nem faz parte do item do inventário.
 *
 * Quando recebe `onUse`, mostra o botão **Usar** (consumível): a ação é
 * disparada no pai e a ficha é atualizada pelo servidor. Sem `onUse` o modal é
 * somente leitura.
 *
 * Reutiliza o visual dos modais do app (`modal-backdrop`/`modal`) e o lightbox
 * único (`useLightbox`) para ampliar a imagem. Fecha pelo "X", pelo clique na
 * área escurecida e pelo Esc.
 */
export function ItemDetailModal({
  item,
  onClose,
  onUse,
  onQuantityChange,
  onRemove,
}: ItemDetailModalProps) {
  const { open: openLightbox } = useLightbox();
  const [using, setUsing] = useState(false);

  function handleUse(): void {
    if (!onUse || using) return;
    setUsing(true);
    void Promise.resolve(onUse()).finally(() => setUsing(false));
  }

  // Esc fecha e a rolagem do fundo fica travada enquanto o modal está aberto.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const rows = itemDetailRows(item.details);
  const rarity = rarityLabel(item.rarity);
  // Cores da raridade: texto na cor cheia e um detalhe/borda discreto (tinta).
  const color = rarityColor(item.rarity);
  const accent = rarityTint(item.rarity, '99');

  return createPortal(
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Detalhes de ${item.name}`}
      onClick={onClose}
    >
      {/* O clique dentro do cartão não fecha (só a área escurecida fecha). */}
      <div
        className="modal item-modal"
        style={{ borderLeftColor: accent ?? undefined, borderLeftWidth: accent ? 4 : undefined }}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="item-modal-close"
          title="Fechar"
          aria-label="Fechar detalhes"
          onClick={onClose}
        >
          <Icon name="x" size={16} />
        </button>

        <header className="item-modal-head">
          <div className="item-modal-figure">
            {item.imageUrl ? (
              <button
                type="button"
                className="item-modal-image"
                title="Ampliar imagem"
                aria-label={`Ampliar imagem: ${item.name}`}
                onClick={() => openLightbox(item.imageUrl, item.name)}
              >
                <img src={item.imageUrl} alt={item.name} />
              </button>
            ) : (
              <span className="item-modal-image is-empty" aria-hidden="true">
                <Icon name="flask" size={44} />
              </span>
            )}
          </div>

          <div className="item-modal-heading">
            <h2 className="item-modal-name">{item.name}</h2>
            <p className="item-modal-tags">
              {item.category ? <span className="item-modal-tag">{item.category}</span> : null}
              {rarity ? (
                <span
                  className="item-modal-tag is-rarity"
                  style={color && accent ? { color, borderColor: accent } : undefined}
                >
                  {rarity}
                </span>
              ) : null}
              <span
                className={
                  item.requiresAttunement
                    ? 'item-modal-tag is-attunement'
                    : 'item-modal-tag is-muted'
                }
              >
                {item.requiresAttunement ? 'Requer Sintonização' : 'Não exige sintonização'}
              </span>
            </p>
          </div>
        </header>

        <div className="item-modal-facts">
          <span className="item-modal-fact">
            <strong>{item.quantity}</strong> unidade{item.quantity > 1 ? 's' : ''}
          </span>
          {item.weight > 0 ? (
            <span className="item-modal-fact">
              <strong>{item.weight}</strong> kg
            </span>
          ) : null}
        </div>

        {/* Proficiência do personagem com este item (vem calculada do servidor). */}
        {item.proficiency ? (
          <p
            className={`item-modal-proficiency${
              item.proficiency.proficient ? '' : ' is-warn'
            }`}
          >
            {item.proficiency.proficient
              ? 'Proficiente com este item.'
              : '⚠ Sem proficiência com este item.'}
          </p>
        ) : null}

        {rows.length > 0 ? (
          <section className="item-modal-block">
            <h3 className="item-modal-block-title">
              <Icon name="sword" size={14} /> Atributos
            </h3>
            <dl className="item-modal-rows">
              {rows.map((row, index) => (
                <div className="item-modal-row" key={`${row.label}-${index}`}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        <section className="item-modal-block">
          <h3 className="item-modal-block-title">
            <Icon name="scroll" size={14} /> Descrição
          </h3>
          <p className="item-modal-desc">{item.description || 'Sem descrição.'}</p>
        </section>

        {onQuantityChange || onRemove ? (
          <div className="item-modal-actions item-modal-manage">
            {onQuantityChange ? (
              <label className="item-modal-qty">
                Qtd.
                <InlineField
                  className="item-modal-qty-field"
                  value={item.quantity}
                  mode="number"
                  min={0}
                  readOnly={false}
                  ariaLabel="Quantidade"
                  onCommit={(value) =>
                    onQuantityChange(clampInt(value, 0, 9999, item.quantity))
                  }
                />
              </label>
            ) : (
              <span className="item-modal-actions-hint">Qtd. {item.quantity}</span>
            )}
            {onRemove ? (
              <button type="button" className="btn btn-danger btn-small" onClick={onRemove}>
                remover
              </button>
            ) : null}
          </div>
        ) : null}

        {onUse ? (
          <div className="item-modal-actions">
            <span className="item-modal-actions-hint">
              {item.quantity > 1
                ? `${item.quantity} unidades · usar consome 1`
                : 'última unidade · usar remove o item'}
            </span>
            <button
              type="button"
              className="btn btn-primary"
              disabled={using}
              title="Consome 1 unidade deste item"
              onClick={handleUse}
            >
              <Icon name="flask" size={15} /> {using ? 'usando...' : 'Usar'}
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
