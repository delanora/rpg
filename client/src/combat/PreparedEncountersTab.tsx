import { EncounterThumbnail } from './EncounterThumbnail';
import { useEffect, useState } from 'react';
import {
  CombatStartDialog,
  type CombatStartDialogProps,
} from './CombatStartDialog';
import {
  deleteEncounter,
  fetchEncounters,
  type PreparedEncounter,
} from './encountersApi';
import './preparation.css';
export function PreparedEncountersTab(
  props: Omit<
    CombatStartDialogProps,
    'onCancel' | 'saveOnly' | 'initialEncounter' | 'onSaved'
  > & { onOpenStart: () => void; combatActive?: boolean },
) {
  const [rows, setRows] = useState<PreparedEncounter[]>([]),
    [editing, setEditing] = useState<PreparedEncounter | null | undefined>(
      undefined,
    );
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const reload = () =>
    fetchEncounters()
      .then(setRows)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void reload();
  }, []);
  return (
    <section className="prepared-encounters">
      <header className="preparation-header">
        <div>
          <h2>Combate</h2>
          <p className="section-subtitle">
            Prepare seus encontros e escolha quando iniciar o combate.
          </p>
        </div>
        <div className="preparation-header-actions">
          <button type="button" className="btn" onClick={() => setEditing(null)}>Criar encontro</button>
          <button type="button" className="btn btn-primary" onClick={props.onOpenStart}
            disabled={props.combatActive} title={props.combatActive ? 'Encerre o combate em andamento antes de iniciar outro.' : undefined}>
            Iniciar combate
          </button>
        </div>
      </header>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      {!rows.length ? (
        <p>
          Nenhum encontro salvo. Prepare participantes, escolha uma cena e
          organize as posições.
        </p>
      ) : null}
      <div className="preparation-cards">
        {rows.map((row) => (
          <article key={row.id} className="preparation-card">
            <EncounterThumbnail sceneId={row.preparation.sceneId} />
            <strong>{row.name}</strong>
            <small>
              {props.localities.find((l) => l.id === row.preparation.localityId)
                ?.name ?? 'Sem localidade'}
            </small>
            <small>
              {row.preparation.characterIds?.length ?? 0} jogadores ·{' '}
              {row.preparation.entries.reduce((n, e) => n + e.quantity, 0)}{' '}
              criaturas/NPCs
            </small>
            <div className="preparation-inline">
              <button className="btn btn-small" onClick={() => setEditing(row)}>
                Editar
              </button>
              <button
                className="btn btn-small"
                onClick={() =>
                  setEditing({
                    ...row,
                    id: '',
                    version: 0,
                    name: `${row.name} — cópia`,
                  })
                }
              >
                Duplicar
              </button>
              <button
                className="btn btn-small"
                onClick={() => setRemoving(row.id)}
              >
                Excluir
              </button>
            </div>
            {removing === row.id ? (
              <div role="alert">
                <p>Excluir este encontro preparado?</p>
                <button
                  className="btn btn-danger btn-small"
                  onClick={() =>
                    void deleteEncounter(row)
                      .then(() => {
                        setRemoving(null);
                        void reload();
                      })
                      .catch((e) => setError(e.message))
                  }
                >
                  Excluir encontro
                </button>
                <button
                  className="btn btn-small"
                  onClick={() => setRemoving(null)}
                >
                  Cancelar
                </button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
      {editing !== undefined ? (
        <CombatStartDialog
          {...props}
          saveOnly
          initialEncounter={editing ?? undefined}
          onSaved={() => void reload()}
          onCancel={() => setEditing(undefined)}
        />
      ) : null}
    </section>
  );
}
