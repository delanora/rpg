import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { InventorySection, type InventorySectionProps } from './sections/InventorySection';

/**
 * Botão flutuante do INVENTÁRIO e o painel com o set de equipamento.
 *
 * O inventário deixou de ocupar o meio da ficha: ele vive num cartão flutuante
 * ancorado à ESQUERDA (acima do botão), que ocupa apenas o espaço necessário
 * para o set — a mochila só entra quando o jogador a abre pelo ícone dela
 * dentro do set (ver `InventorySection`), e as moedas ficam dentro da mochila.
 *
 * O botão fica na base da pilha inferior esquerda (o botão dos dados sobe para
 * a posição de cima — ver `.inv-fab`/`.dice-fab` em styles.css). Fecha pelo
 * "X", pelo próprio botão e pelo Esc.
 */
export function InventoryDock(props: InventorySectionProps) {
  const [open, setOpen] = useState(false);

  // Esc fecha o painel.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const itemCount = props.character.inventory.length;

  return (
    <>
      <button
        type="button"
        className={open ? 'inv-fab active' : 'inv-fab'}
        aria-expanded={open}
        aria-controls="sheet-inventory-panel"
        title={open ? 'Fechar o inventário' : 'Abrir o inventário'}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="bag" size={18} />
        <span className="inv-fab-label">Inventário</span>
        {itemCount > 0 ? <span className="inv-fab-count">{itemCount}</span> : null}
      </button>

      {open ? (
        <div className="inv-panel" id="sheet-inventory-panel" role="dialog" aria-label="Inventário">
          <button
            type="button"
            className="notes-drawer-close"
            aria-label="Fechar o inventário"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
          <div className="inv-panel-head">
            <Icon name="bag" size={15} />
            <span>Inventário</span>
          </div>
          <InventorySection {...props} />
        </div>
      ) : null}
    </>
  );
}
