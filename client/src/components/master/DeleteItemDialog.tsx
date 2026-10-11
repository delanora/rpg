import { useEffect, useState } from 'react';
import { categoryLabel } from '../../dnd';
import type { Character, Item } from '../../types';
import { Icon } from '../Icon';

interface DeleteItemDialogProps {
  /** Item que será excluído (o nome dele aparece no texto da confirmação). */
  item: Item;
  /**
   * Personagens que têm este item no inventário — dado que já está carregado no
   * painel. Quando vazio, nenhum aviso extra é mostrado.
   */
  usedBy: Character[];
  onCancel: () => void;
  /**
   * Executa a exclusão no servidor. Deve rejeitar quando falhar — o diálogo
   * continua aberto com a mensagem do erro.
   */
  onConfirm: () => Promise<void>;
}

/**
 * Confirmação da exclusão de um item do catálogo.
 *
 * A ação é irreversível: o texto diz exatamente o que desaparece e, quando o
 * painel já sabe que o item está em algum inventário, avisa quem o tem — nada
 * de um "tem certeza?" genérico. Só o segundo clique (no botão vermelho) apaga;
 * Esc e "cancelar" fecham.
 */
export function DeleteItemDialog({ item, usedBy, onCancel, onConfirm }: DeleteItemDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Esc cancela — nunca confirma, para um toque errado não apagar nada.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !busy) onCancel();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onCancel]);

  async function confirm(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      await onConfirm();
      onCancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao excluir o item.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Excluir ${item.name}`}
    >
      <div className="modal delete-dialog">
        <h2>
          <Icon name="trash" size={20} /> Excluir item
        </h2>

        <p className="section-note">
          Esta ação <strong>não pode ser desfeita</strong>.
        </p>

        <p className="delete-target">
          {item.name} <span className="muted">· {categoryLabel(item.category)}</span>
        </p>

        <p>Tem certeza que deseja excluir este item?</p>

        <ul>
          <li>O item sai do catálogo central do mestre e não pode mais ser enviado aos jogadores.</li>
          <li>O sprite, os atributos e o preço cadastrados são perdidos.</li>
        </ul>

        {usedBy.length > 0 ? (
          <p className="delete-item-usage">
            <Icon name="info" size={16} /> Este item está no inventário de{' '}
            <strong>{usedBy.map((character) => character.name).join(', ')}</strong>. A cópia que
            está com os personagens <strong>permanece</strong>, mas deixa de ser atualizada pelo
            catálogo.
          </p>
        ) : null}

        {error ? <p className="form-error">{error}</p> : null}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            cancelar
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => void confirm()}
            disabled={busy}
          >
            <Icon name="trash" size={14} />
            {busy ? 'excluindo...' : 'excluir item'}
          </button>
        </div>
      </div>
    </div>
  );
}
