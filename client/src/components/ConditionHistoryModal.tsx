import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

/**
 * JANELA DO HISTÓRICO MECÂNICO — aberta ao clicar numa etiqueta de condição.
 *
 * O histórico deixou de ser um bloco recolhido no rodapé da ficha (que gastava
 * espaço o tempo todo para algo que se consulta de vez em quando): ele agora
 * aparece sob demanda, por cima da ficha. O título traz a condição clicada como
 * CONTEXTO; as entradas são o registro inteiro da criatura, do mais recente para
 * o mais antigo — é o mesmo `mechanicalState.log` do servidor, sem filtro local.
 */
export interface ConditionHistoryEntry {
  id: string;
  message: string;
}

export function ConditionHistoryModal({
  condition,
  entries,
  onClose,
}: {
  /** Nome visível da condição clicada (só contexto, não filtra o registro). */
  condition: string;
  /** Registro mecânico em ordem DECRESCENTE (mais recente primeiro). */
  entries: ConditionHistoryEntry[];
  onClose: () => void;
}) {
  // Esc fecha; o corpo da página não rola atrás da janela.
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

  return createPortal(
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Histórico mecânico — ${condition}`}
      onClick={onClose}
    >
      {/* Clique dentro do cartão não fecha (só a área escurecida fecha). */}
      <div className="modal condition-history-modal" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="condition-history-close"
          title="Fechar"
          aria-label="Fechar histórico"
          onClick={onClose}
        >
          <Icon name="x" size={16} />
        </button>

        <h2>
          <Icon name="scroll" size={18} />
          Histórico mecânico
        </h2>
        <p className="condition-history-context">Condição: {condition}</p>

        {entries.length === 0 ? (
          <p className="field-hint">Nada registrado até aqui.</p>
        ) : (
          <ol className="condition-history-list">
            {entries.map((entry) => (
              <li key={entry.id}>{entry.message}</li>
            ))}
          </ol>
        )}
      </div>
    </div>,
    document.body,
  );
}
