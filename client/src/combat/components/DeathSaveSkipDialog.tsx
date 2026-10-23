import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/Icon';

interface DeathSaveSkipDialogProps {
  /** Nome do combatente que ainda não rolou o Teste Contra a Morte do turno. */
  name: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * CONFIRMAÇÃO DO MESTRE para avançar o turno sem o Teste Contra a Morte
 * obrigatório daquele turno (PHB 2014).
 *
 * Só o Mestre vê esta janela: o servidor recusa o avanço do jogador com
 * `DEATH_SAVE_PENDING` e não existe caminho de override para ele. Avançar NÃO
 * inventa sucesso/falha — apenas passa o turno, e o servidor registra o
 * override no Registro do combate.
 */
export function DeathSaveSkipDialog({
  name,
  busy = false,
  onCancel,
  onConfirm,
}: DeathSaveSkipDialogProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onCancel]);

  return createPortal(
    <div className="death-overlay" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="death-stage" onClick={(event) => event.stopPropagation()}>
        <header className="death-stage-head">
          <Icon name="skull" size={16} />
          <h2>Teste Contra a Morte pendente</h2>
          <button type="button" className="death-stage-close" aria-label="Fechar" onClick={onCancel}>
            <Icon name="x" size={16} />
          </button>
        </header>

        <p className="death-text">
          <strong>{name}</strong> ainda não realizou o Teste Contra a Morte deste turno.
          Deseja avançar mesmo assim?
        </p>
        <p className="death-hint">
          Avançar apenas passa o turno: nenhum sucesso ou falha é somado
          automaticamente.
        </p>

        <div className="death-options">
          <button type="button" className="death-button" disabled={busy} onClick={onCancel}>
            <strong>Cancelar</strong>
            <span>Voltar e esperar o Teste Contra a Morte.</span>
          </button>
          <button
            type="button"
            className="death-button danger"
            disabled={busy}
            onClick={onConfirm}
          >
            <strong>Avançar mesmo assim</strong>
            <span>Registra o override no Registro do combate.</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
