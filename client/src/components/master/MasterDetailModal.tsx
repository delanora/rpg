import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../Icon';

interface MasterDetailModalProps {
  /** Rótulo curto do que está aberto ("Ficha", "Criatura", "NPC", "Região"). */
  kind: string;
  /** Nome da entidade — vira o título do cabeçalho. */
  title: string;
  /** Linha de contexto abaixo do título (jogador, tipo/ND, localidades...). */
  subtitle?: ReactNode;
  /** Botões de ação do cabeçalho (editar, excluir, reduzir nível...). */
  actions?: ReactNode;
  /** Fecha pela área escurecida, pelo Esc e pelo botão "fechar". */
  onClose: () => void;
  /** Diálogo de confirmação aberto por cima: o Esc daqui é ignorado. */
  suspended?: boolean;
  /**
   * `sheet` = ficha do jogador: a janela ocupa 85% da tela e o retrato do
   * personagem aparece inteiro (sem herdar a margem de transbordo da página).
   */
  size?: 'default' | 'sheet';
  children: ReactNode;
}

/**
 * Janela flutuante de detalhe/edição das listas do painel do mestre.
 *
 * É a MESMA linguagem do modal do catálogo de itens (`.items-modal-bar` +
 * `.modal`), agora compartilhada por **Fichas**, **Criaturas**, **NPCs** e
 * **Regiões**: a lista ocupa a largura toda em cards e o conteúdo completo abre
 * numa janela por cima, em vez de dividir a tela com uma coluna lateral.
 *
 * Cuida do que todo modal precisa: portal no `<body>`, rolagem do fundo travada,
 * Esc para fechar (respeitando o diálogo de confirmação que estiver por cima),
 * foco no diálogo ao abrir e fechamento pelo clique na área escurecida.
 */
export function MasterDetailModal({
  kind,
  title,
  subtitle,
  actions,
  onClose,
  suspended = false,
  size = 'default',
  children,
}: MasterDetailModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !suspended) onClose();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, suspended]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return createPortal(
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`${kind}: ${title}`}
      inert={suspended || undefined}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className={`modal detail-modal${size === 'sheet' ? ' is-sheet' : ''}`}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="items-modal-bar">
          <span className="items-modal-mode">{kind}</span>
          <div className="items-modal-bar-actions">
            {actions}
            <button type="button" className="btn btn-small" onClick={onClose}>
              <Icon name="x" size={14} /> fechar
            </button>
          </div>
        </div>

        <header className="detail-modal-head">
          <h2 className="detail-modal-title">{title}</h2>
          {subtitle ? <p className="detail-modal-subtitle">{subtitle}</p> : null}
        </header>

        <div className="detail-modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
