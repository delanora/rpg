import { useCallback, useEffect, useState } from 'react';
import {
  approveIntent,
  denyIntent,
  listIntents,
  type SpellCastIntent,
} from '../spellcastingApi';

/**
 * Fila de CONFIRMAÇÃO ESPACIAL do Mestre (Fase 6.6F).
 *
 * O jogador não pode confirmar o que o servidor não mede (alcance, caminho livre,
 * visão, distância entre alvos). A intenção fica aqui — sem custo nenhum — e o
 * Mestre confirma APENAS os requisitos que o servidor declarou. Ele nunca digita
 * distância, máximo de alvos ou CD.
 */
const REQUIREMENT_LABELS: Record<string, string> = {
  range: 'Todos os alvos dentro do alcance',
  sight: 'Todos os alvos à vista',
  clearPath: 'Caminho livre até os alvos',
  groupDistance: 'Alvos próximos uns dos outros',
};

/** Requisito do servidor → campo de evidência aceito pelo endpoint de aprovação. */
const EVIDENCE_FIELD: Record<string, string> = {
  range: 'withinRange',
  sight: 'sight',
  clearPath: 'clearPath',
  groupDistance: 'groupDistance',
};

export function MasterSpellIntentsPanel() {
  const [intents, setIntents] = useState<SpellCastIntent[]>([]);
  const [checked, setChecked] = useState<Record<string, Set<string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setIntents(await listIntents());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao carregar a fila.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(intentId: string, action: 'approve' | 'deny') {
    const intent = intents.find((item) => item.id === intentId);
    if (!intent) return;
    setBusy(true);
    setError(null);
    try {
      if (action === 'deny') {
        await denyIntent(intentId, 'Recusada pelo Mestre.');
      } else {
        const marks = checked[intentId] ?? new Set<string>();
        const confirmation: Record<string, boolean> = {};
        for (const kind of intent.requiredConfirmations) {
          const field = EVIDENCE_FIELD[kind];
          if (field) confirmation[field] = marks.has(kind);
        }
        await approveIntent(intentId, confirmation);
      }
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao resolver a solicitação.');
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="master-spell-intents">
      <p className="muted">Conjurações aguardando confirmação</p>
      {error ? <p className="muted">{error}</p> : null}
      {intents.length === 0 ? (
        <p className="muted">Nenhuma pendência.</p>
      ) : (
        <ul>
          {intents.map((intent) => {
            const marks = checked[intent.id] ?? new Set<string>();
            return (
              <li key={intent.id}>
                <strong>{intent.spellName}</strong>{' '}
                <span className="muted">
                  {intent.caster.label ?? intent.caster.kind} · alvos:{' '}
                  {intent.targets.map((target) => target.name || target.id).join(', ') || '—'}
                </span>
                <ul>
                  {intent.requiredConfirmations.map((kind) => (
                    <li key={kind}>
                      <label>
                        <input
                          type="checkbox"
                          checked={marks.has(kind)}
                          onChange={() =>
                            setChecked((current) => {
                              const next = new Set(current[intent.id] ?? []);
                              if (next.has(kind)) next.delete(kind);
                              else next.add(kind);
                              return { ...current, [intent.id]: next };
                            })
                          }
                        />{' '}
                        {REQUIREMENT_LABELS[kind] ?? kind}
                      </label>
                    </li>
                  ))}
                </ul>
                <button type="button" className="btn btn-small" disabled={busy} onClick={() => void act(intent.id, 'approve')}>
                  Aprovar
                </button>{' '}
                <button type="button" className="btn btn-small" disabled={busy} onClick={() => void act(intent.id, 'deny')}>
                  Negar
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="muted">
        Aprovar revalida turno, Ação, espaço, fonte, repertório e alvos antes do commit: alguma
        mudança invalida a solicitação sem gastar nada.
      </p>
    </div>
  );
}
