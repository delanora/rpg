import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { categoryLabel, itemDetailRows, rarityColor, rarityLabel, rarityTint } from '../../dnd';
import type { CanonicalWeapon, Character, Item, ItemPatch } from '../../types';
import { Icon } from '../Icon';
import { useLightbox } from '../Lightbox';
import { ItemDeliverPanel } from './ItemDeliverPanel';
import { ItemEditor } from './ItemEditor';
import { priceLabel } from './itemCatalog';

/** O modal abre em visualização e o botão Editar alterna para o formulário. */
export type ItemModalMode = 'view' | 'edit';

interface ItemModalCardProps {
  item: Item;
  mode: ItemModalMode;
  /** Abriu a partir de "Novo item": o cabeçalho avisa que é uma criação. */
  creating?: boolean;
  characters: Character[];
  weapons: CanonicalWeapon[];
  onPatch: (patch: ItemPatch) => void;
  onSend: (characterId: string, quantity: number) => Promise<void>;
  /** Alterna entre visualização e edição (o MESMO modal). */
  onModeChange: (mode: ItemModalMode) => void;
  /** Pede a confirmação de exclusão (o diálogo mora no pai). */
  onRequestDelete: () => void;
  /** Painel de ENTREGA aberto (ação contextual do modal). */
  delivering: boolean;
  /** Aviso discreto do último envio bem-sucedido (o modal segue aberto). */
  feedback: string | null;
  /** Abre/fecha o painel de entrega. */
  onDeliverOpen: (open: boolean) => void;
  /** A entrega deu certo: mostra o aviso e fecha só o painel. */
  onDelivered: (message: string) => void;
  onClose: () => void;
}

interface ItemModalProps
  extends Omit<
    ItemModalCardProps,
    'delivering' | 'feedback' | 'onDeliverOpen' | 'onDelivered'
  > {
  /** Enquanto a confirmação de exclusão está aberta por cima, o Esc não fecha. */
  suspended?: boolean;
}

/**
 * Conteúdo do modal do item (barra de ações no topo + corpo em visualização ou
 * edição). Fica separado do `ItemModal` para poder ser montado sem portal.
 */
export function ItemModalCard({
  item,
  mode,
  creating = false,
  characters,
  weapons,
  onPatch,
  onSend,
  onModeChange,
  onRequestDelete,
  delivering,
  feedback,
  onDeliverOpen,
  onDelivered,
  onClose,
}: ItemModalCardProps) {
  const { open: openLightbox } = useLightbox();

  const rarity = rarityLabel(item.rarity);
  const color = rarityColor(item.rarity);
  const accent = rarityTint(item.rarity, '99');

  const rows = itemDetailRows(item.details);
  if (item.category === 'CAMP_SUPPLY') {
    rows.push({
      label: 'Recursos de acampamento',
      value: `${item.campSupply?.value ?? 0} por unidade`,
    });
  }

  return (
    <>
      <div className="items-modal-bar">
        {creating ? <span className="items-modal-mode">Novo item</span> : null}
        <div className="items-modal-bar-actions">
          {/* "Entregar" fica imediatamente ao lado de "Editar". */}
          <button
            type="button"
            className="btn btn-small"
            disabled={characters.length === 0}
            title={
              characters.length === 0
                ? 'Nenhum jogador com ficha ainda.'
                : `Entregar uma cópia de ${item.name} a um jogador`
            }
            onClick={() => onDeliverOpen(!delivering)}
          >
            <Icon name="bag" size={14} /> entregar
          </button>
          {mode === 'view' ? (
            <button type="button" className="btn btn-small" onClick={() => onModeChange('edit')}>
              <Icon name="quill" size={14} /> editar
            </button>
          ) : (
            <button type="button" className="btn btn-small" onClick={() => onModeChange('view')}>
              <Icon name="eye" size={14} /> concluir edição
            </button>
          )}
          <button type="button" className="btn btn-danger btn-small" onClick={onRequestDelete}>
            <Icon name="trash" size={14} /> excluir
          </button>
          <button type="button" className="btn btn-small" onClick={onClose}>
            <Icon name="x" size={14} /> fechar
          </button>
        </div>
      </div>

      {feedback ? <p className="items-modal-feedback">✓ {feedback}</p> : null}

      {delivering ? (
        <ItemDeliverPanel
          item={item}
          characters={characters}
          onSend={onSend}
          onDelivered={onDelivered}
          onCancel={() => onDeliverOpen(false)}
        />
      ) : null}

      {mode === 'view' ? (
        <>
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
                <span className="item-modal-tag">{categoryLabel(item.category)}</span>
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
            {item.weight > 0 ? (
              <span className="item-modal-fact">
                <strong>{item.weight}</strong> kg
              </span>
            ) : null}
            <span className="item-modal-fact">
              Valor: <strong>{priceLabel(item) || 'sem valor'}</strong>
            </span>
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
        </>
      ) : (
        <ItemEditor
          embedded
          item={item}
          weapons={weapons}
          onPatch={onPatch}
          onDelete={onRequestDelete}
        />
      )}
    </>
  );
}

/**
 * Detalhes de um item do catálogo do mestre, em modal central flutuante.
 *
 * Começa em **visualização** (só leitura) e o botão **Editar** troca o corpo
 * pelo formulário já existente (`ItemEditor`) — é o mesmo modal, nada de
 * navegação nova. Reaproveita o visual do modal de item do inventário
 * (`item-modal-*`) para manter a mesma identidade. Fecha pelo "fechar", pelo
 * clique na área escurecida e pelo Esc.
 */
export function ItemModal({ onClose, suspended = false, ...card }: ItemModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [delivering, setDelivering] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Esc fecha (menos quando a confirmação de exclusão ou o painel de entrega
  // estão por cima — os dois tratam o próprio Esc) e a rolagem do fundo fica
  // travada enquanto o modal está aberto.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !suspended && !delivering) onClose();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, suspended, delivering]);

  // Foco no próprio diálogo ao abrir: o teclado já opera o modal.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return createPortal(
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={card.creating ? 'Novo item' : `Detalhes de ${card.item.name}`}
      onClick={onClose}
    >
      {/* O clique dentro do cartão não fecha (só a área escurecida fecha). */}
      <div
        ref={dialogRef}
        className="modal item-modal items-modal"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <ItemModalCard
          {...card}
          delivering={delivering}
          feedback={feedback}
          onDeliverOpen={setDelivering}
          onDelivered={(message) => {
            setFeedback(message);
            setDelivering(false);
          }}
          onClose={onClose}
        />
      </div>
    </div>,
    document.body,
  );
}
