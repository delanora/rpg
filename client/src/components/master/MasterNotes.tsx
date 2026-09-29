import { useEffect, useState } from 'react';
import { fetchMasterNotes, saveMasterNotes } from '../../gameApi';
import { Icon } from '../Icon';
import { Section } from '../Section';

interface MasterNotesProps {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}

/**
 * Anotações do mestre sobre a mesa.
 *
 * É o MESMO esquema das anotações do jogador (botão de pena + painel flutuante
 * com salvamento automático ao sair do campo), com duas diferenças: ficam na
 * configuração da mesa (`GameConfig.masterNotes`) em vez de na ficha, e só o
 * mestre as vê — nada disso vai para o jogador nem para a mesa.
 *
 * O painel é flutuante (não ocupa a tela) e abre acima da pilha de botões.
 */
export function MasterNotes({ open, onToggle, onClose }: MasterNotesProps) {
  const [notes, setNotes] = useState('');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Carga única: são anotações privadas, sem evento de tempo real. O painel
  // pode abrir depois — o texto já está pronto.
  useEffect(() => {
    let active = true;

    fetchMasterNotes()
      .then((value) => {
        if (!active) return;
        setNotes(value);
        setDraft(value);
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Falha ao carregar as anotações.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  /** Salva ao sair do campo (sem botão de salvar, como as anotações do jogador). */
  async function save(): Promise<void> {
    if (draft === notes) return;

    try {
      const saved = await saveMasterNotes(draft);
      setNotes(saved);
      setSavedAt(new Date().toLocaleTimeString('pt-BR'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar as anotações.');
    }
  }

  return (
    <>
      <button
        type="button"
        className={
          open ? 'notes-fab master-notes-fab active' : 'notes-fab master-notes-fab'
        }
        aria-expanded={open}
        aria-controls="master-notes-panel"
        title={open ? 'Fechar as anotações' : 'Abrir as anotações da mesa'}
        onClick={onToggle}
      >
        <Icon name="quill" size={18} />
        <span className="notes-fab-label">Anotações</span>
      </button>

      {open ? (
        <div
          className="master-fab-panel"
          id="master-notes-panel"
          role="dialog"
          aria-label="Anotações do mestre"
        >
          <button
            type="button"
            className="notes-drawer-close"
            aria-label="Fechar as anotações"
            onClick={onClose}
          >
            ×
          </button>

          <Section
            title="Anotações do mestre"
            icon="quill"
            subtitle={
              savedAt
                ? `salvo às ${savedAt}`
                : 'salvo automaticamente ao sair do campo — visível só para você'
            }
          >
            <textarea
              className="notes-area"
              value={draft}
              rows={10}
              disabled={loading}
              aria-label="Anotações do mestre sobre a mesa"
              placeholder="Ideias, pistas, consequências, nomes, o que a mesa já sabe..."
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => void save()}
            />
          </Section>

          {error ? <p className="form-error">{error}</p> : null}
        </div>
      ) : null}
    </>
  );
}
