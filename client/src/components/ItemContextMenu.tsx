import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';

/** Uma opção do menu flutuante do item. */
export interface ItemMenuOption {
  id: string;
  label: string;
  icon?: IconName;
  /** Linha de apoio abaixo do rótulo (motivo/observação). */
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

interface ItemContextMenuProps {
  /** Coordenadas do clique (viewport) — o menu é `position: fixed`. */
  x: number;
  y: number;
  title?: string;
  /** Nota fixa no pé do menu (ex.: resolução pelo Mestre). */
  note?: string;
  options: ItemMenuOption[];
  onClose: () => void;
}

/**
 * MENU CONTEXTUAL do item, compacto e flutuante.
 *
 * Vive num PORTAL em `document.body` com `position: fixed`, então abre acima
 * do painel do inventário, não é recortado pelo `overflow` do container e não
 * empurra o layout. O MESMO componente serve para "Usar em..." (a lista de
 * alvos é só outra lista de opções) — nada de modal grande.
 *
 * Fecha ao clicar fora, ao Esc, ao rolar e após qualquer escolha. As opções são
 * montadas pelo chamador: aqui não existe regra de item, só apresentação.
 */
export function ItemContextMenu({ x, y, title, note, options, onClose }: ItemContextMenuProps) {
  const anchor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(event: MouseEvent): void {
      if (anchor.current && !anchor.current.contains(event.target as Node)) onClose();
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  // Preso às bordas: perto do rodapé/canto direito o menu sobe e recua.
  const width = 232;
  const left = Math.max(8, Math.min(x, window.innerWidth - width - 8));
  const estimated = 46 + options.length * 46 + (note ? 40 : 0);
  const top = Math.max(8, Math.min(y, window.innerHeight - estimated - 8));

  return createPortal(
    <div
      ref={anchor}
      className="item-menu"
      role="menu"
      aria-label={title ?? 'Opções do item'}
      style={{ left, top, width }}
    >
      {title ? <p className="item-menu-head">{title}</p> : null}

      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="menuitem"
          className={option.danger ? 'item-menu-option is-danger' : 'item-menu-option'}
          disabled={option.disabled}
          title={option.hint}
          onClick={() => {
            option.onSelect();
            onClose();
          }}
        >
          {option.icon ? <Icon name={option.icon} size={14} /> : null}
          <span className="item-menu-option-body">
            <span className="item-menu-option-label">{option.label}</span>
            {option.hint ? <span className="item-menu-option-hint">{option.hint}</span> : null}
          </span>
        </button>
      ))}

      {note ? <p className="item-menu-note">{note}</p> : null}
    </div>,
    document.body,
  );
}
