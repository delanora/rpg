import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { itemDetailRows, rarityColor, rarityLabel, rarityTint } from '../dnd';
import type { InventoryItem } from '../types';
import { Icon } from './Icon';
import { useLightbox } from './Lightbox';

interface ItemDetailModalProps {
  item: InventoryItem;
  onClose: () => void;
}

/**
 * Ficha detalhada de um item do inventário, aberta no clique.
 *
 * É SOMENTE LEITURA: usa os dados que já estão no item e nunca toca na ficha,
 * no inventário ou no banco (nada de quantidade, equipamento ou cópia). O
 * campo **Valor** nunca aparece aqui — o preço é informação exclusiva do mestre
 * e nem faz parte do item do inventário.
 *
 * Reutiliza o visual dos modais do app (`modal-backdrop`/`modal`) e o lightbox
 * único (`useLightbox`) para ampliar a imagem. Fecha pelo "X", pelo clique na
 * área escurecida e pelo Esc.
 */
export function ItemDetailModal({ item, onClose }: ItemDetailModalProps) {
  const { open: openLightbox } = useLightbox();

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
      </div>
    </div>,
    document.body,
  );
}
