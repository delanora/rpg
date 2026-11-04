import { useCallback, useEffect, useState } from 'react';
import {
  fetchRepertoire,
  savePreparationPlan,
  type CharacterRepertoire,
  type RepertoireSource,
} from '../spellcastingApi';

/**
 * Repertório de magias da FICHA (Fase 6.6F).
 *
 * Mostra, POR FONTE, o que está ACTIVE, o que está PLANEJADO, o limite manual e as
 * candidatas — nunca uma lista global: Mago e Clérigo do mesmo personagem têm
 * preparações independentes. O Tomo/Grimório animado continua sendo fase de UX
 * própria; esta é a prova funcional do domínio.
 */
const MODE_LABELS: Record<string, string> = {
  known: 'conhecidas',
  'prepared-list': 'preparadas (lista da classe)',
  'spellbook-prepared': 'grimório + preparadas',
  explicit: 'statblock',
};

export function SpellRepertoirePanel({ characterId }: { characterId: string }) {
  const [repertoire, setRepertoire] = useState<CharacterRepertoire | null>(null);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [planned, setPlanned] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchRepertoire(characterId);
      setRepertoire(data);
      return data;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao carregar o repertório.');
      return null;
    }
  }, [characterId]);

  useEffect(() => {
    void load();
  }, [load]);

  const source: RepertoireSource | undefined = repertoire?.sources[sourceIndex];

  // O PLANO começa como a preparação ACTIVE: salvar sem mexer é inofensivo.
  useEffect(() => {
    if (!source) return;
    setPlanned(new Set(source.entries.filter((entry) => entry.planned && !entry.alwaysPrepared).map((entry) => entry.spellId)));
  }, [source]);

  if (error) return <p className="muted">{error}</p>;
  if (!repertoire) return <p className="muted">Carregando repertório…</p>;
  if (repertoire.sources.length === 0) {
    return <p className="muted">Este personagem não possui fonte de conjuração utilizável.</p>;
  }

  async function save() {
    if (!source) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await savePreparationPlan({
        characterId,
        source: { kind: source.source.kind, id: source.source.id },
        spellIds: [...planned],
        expectedVersion: repertoire!.version,
      });
      setRepertoire(updated);
      setNotice(
        'Plano salvo. A preparação ATIVA só muda ao concluir o próximo Descanso Longo válido.',
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao salvar o plano.');
      await load();
    } finally {
      setBusy(false);
    }
  }

  function toggle(spellId: string) {
    setPlanned((current) => {
      const next = new Set(current);
      if (next.has(spellId)) next.delete(spellId);
      else next.add(spellId);
      return next;
    });
  }

  const overLimit =
    source && source.manualLimit !== null ? planned.size > source.manualLimit : false;

  return (
    <div className="spell-repertoire">
      {repertoire.sources.length > 1 ? (
        <p>
          {repertoire.sources.map((item, index) => (
            <button
              key={`${item.source.kind}:${item.source.id}`}
              type="button"
              className={`btn btn-small${index === sourceIndex ? ' active' : ''}`}
              onClick={() => {
                setSourceIndex(index);
                setNotice(null);
              }}
            >
              {item.source.label}
            </button>
          ))}
        </p>
      ) : null}

      {!source ? null : (
        <>
          <p className="muted">
            {source.source.label} · {MODE_LABELS[source.mode] ?? source.modeLabel} · magias até
            nível {source.maxSpellLevel}
            {source.manualLimit === null
              ? ''
              : ` · preparadas ${source.activeCount}/${source.manualLimit}`}
          </p>

          {source.planPending ? (
            <p className="muted">
              Alterações de preparação pendentes: serão aplicadas após o próximo Descanso Longo
              válido.
            </p>
          ) : null}
          {notice ? <p className="muted">{notice}</p> : null}
          {error ? <p className="muted">{error}</p> : null}

          {source.entries.length === 0 ? (
            <p className="muted">Nenhuma magia neste repertório.</p>
          ) : (
            <ul>
              {source.entries.map((entry) => (
                <li key={entry.spellId}>
                  <strong>{entry.name}</strong>{' '}
                  <span className="muted">
                    {entry.level === 0 ? 'truque' : `nível ${entry.level}`}
                    {entry.active ? ' · preparada' : entry.recorded ? ' · registrada' : ''}
                    {entry.known && !entry.active ? ' · conhecida' : ''}
                    {entry.alwaysPrepared ? ' · sempre preparada' : ''}
                  </span>{' '}
                  {entry.executable ? (
                    <button type="button" className="btn btn-small" disabled title="Conjuração iniciada pela ficha chega na próxima etapa de UX">
                      Conjurar
                    </button>
                  ) : (
                    <span className="muted">automação de conjuração não implementada</span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {source.manualLimit === null || source.candidates.length === 0 ? null : (
            <>
              <p className="muted">
                Planejar preparadas ({planned.size}/{source.manualLimit}). Magias sempre preparadas
                não contam no limite.
              </p>
              <ul>
                {source.candidates.map((candidate) => (
                  <li key={candidate.spellId}>
                    <label>
                      <input
                        type="checkbox"
                        checked={planned.has(candidate.spellId)}
                        onChange={() => toggle(candidate.spellId)}
                      />{' '}
                      {candidate.name}{' '}
                      <span className="muted">
                        {candidate.level === 0 ? 'truque' : `nível ${candidate.level}`}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="btn btn-small"
                disabled={busy || overLimit}
                onClick={() => void save()}
              >
                {overLimit ? 'Acima do limite de preparação' : 'Salvar plano'}
              </button>
            </>
          )}
          <p className="muted">
            Componentes (V/S/M) ainda não fazem parte da validação de conjuração.
          </p>
        </>
      )}
    </div>
  );
}
