import { useEffect, useState } from 'react';
import type { Character } from '../../types';
import { Icon } from '../Icon';

interface DeleteCharacterDialogProps {
  /** Ficha que será excluída (o nome dela aparece no texto da confirmação). */
  character: Character;
  onCancel: () => void;
  /**
   * Executa a exclusão no servidor. Deve rejeitar quando falhar — o diálogo
   * continua aberto com a mensagem do erro.
   */
  onConfirm: () => Promise<void>;
}

/**
 * Confirmação da exclusão de um personagem.
 *
 * A ação é irreversível e vai além da ficha: exclui também a **conta do
 * jogador**, então o texto diz exatamente o que desaparece e quem perde o
 * acesso — nada de um "tem certeza?" genérico. Só o segundo clique (no botão
 * vermelho) apaga; Esc e "cancelar" fecham.
 */
export function DeleteCharacterDialog({
  character,
  onCancel,
  onConfirm,
}: DeleteCharacterDialogProps) {
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
      setError(err instanceof Error ? err.message : 'Falha ao excluir o personagem.');
    } finally {
      setBusy(false);
    }
  }

  const owner = character.ownerUsername ?? '—';

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Excluir ${character.name}`}
    >
      <div className="modal delete-dialog">
        <h2>
          <Icon name="trash" size={20} /> Excluir personagem
        </h2>

        <p className="section-note">
          Esta ação <strong>não pode ser desfeita</strong>.
        </p>

        <p className="delete-target">
          {character.name} <span className="muted">· jogador: {owner}</span>
        </p>

        <ul>
          <li>A ficha inteira: atributos, perícias, inventário, magias, ataques e anotações.</li>
          <li>
            A <strong>conta do jogador {owner}</strong> — ele não conseguirá mais entrar no
            grimório com este usuário e senha.
          </li>
          <li>O avatar enviado e a participação dele em um combate em andamento.</li>
        </ul>

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
            {busy ? 'excluindo...' : 'excluir personagem e conta'}
          </button>
        </div>
      </div>
    </div>
  );
}
