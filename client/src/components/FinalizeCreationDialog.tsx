import { useEffect, useState } from 'react';
import { Icon } from './Icon';

interface FinalizeCreationDialogProps {
  characterName: string;
  onCancel: () => void;
  /**
   * Encerra a criação no servidor. Deve rejeitar quando falhar — o diálogo
   * continua aberto com a mensagem do erro.
   */
  onConfirm: () => Promise<void>;
}

/**
 * Confirmação do fim da criação do personagem.
 *
 * O botão é **provisório** (o wizard de criação vai substituí-lo), mas a trava
 * é real: depois de finalizar, identidade, atributos, proficiências, classes,
 * PV máximo e CA só mudam pelo Level Up ou pelo mestre. O diálogo diz isso em
 * vez de um "tem certeza?" genérico, e lembra o que continua liberado.
 */
export function FinalizeCreationDialog({
  characterName,
  onCancel,
  onConfirm,
}: FinalizeCreationDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError(err instanceof Error ? err.message : 'Falha ao finalizar a criação.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Finalizar a criação de ${characterName}`}
    >
      <div className="modal">
        <h2>
          <Icon name="scroll" size={20} /> Finalizar criação
        </h2>

        <p className="section-note">
          Depois de finalizar, o personagem passa a ser <strong>jogado</strong> — a montagem acaba
          aqui.
        </p>

        <h3 className="subsection-title">Deixa de ser editável para você</h3>
        <ul className="modal-list">
          <li>Identidade: nome, raça, antecedente e alinhamento.</li>
          <li>Atributos e proficiências de perícias e salvaguardas.</li>
          <li>Classes e subclasses (o nível sobe pelo Level Up).</li>
          <li>PV máximo, Classe de Armadura, iniciativa e deslocamento.</li>
          <li>Magias conhecidas, ataques e características.</li>
        </ul>

        <h3 className="subsection-title">Continua liberado</h3>
        <ul className="modal-list">
          <li>PV atual e PV temporário.</li>
          <li>Gastar e recuperar espaços de magia e usos de recursos de classe.</li>
          <li>Anotações, avatar e movimentação de itens no inventário.</li>
        </ul>

        <p className="section-note">
          O <strong>Level Up</strong> continua subindo o personagem e o <strong>mestre</strong> pode
          editar qualquer campo a qualquer momento.
        </p>

        {error ? <p className="form-error">{error}</p> : null}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void confirm()}
            disabled={busy}
          >
            <Icon name="scroll" size={14} />
            {busy ? 'finalizando...' : 'finalizar criação'}
          </button>
        </div>
      </div>
    </div>
  );
}
