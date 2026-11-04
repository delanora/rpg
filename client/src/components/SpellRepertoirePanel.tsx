import { useCallback, useEffect, useRef, useState } from 'react';
import { newId } from '../utils';
import {
  cancelIntent,
  castErrorMessage,
  castSpell,
  fetchCastOptions,
  fetchRepertoire,
  listIntents,
  savePreparationPlan,
  subscribeSpellIntents,
  type CastOptions,
  type CastResourceOption,
  type CastTargetingSummary,
  type CharacterRepertoire,
  type RepertoireSource,
  type SpellCastIntent,
} from '../spellcastingApi';

/**
 * Repertório de magias da FICHA (Fase 6.6F) + fluxo de conjuração (6.6F.1).
 *
 * O repertório é mostrado POR FONTE (ACTIVE × PLANEJADO) — Mago e Clérigo do mesmo
 * personagem têm preparações independentes. O botão "Conjurar" abre o fluxo real:
 * fonte → espaço → alvos → `POST /api/spells/cast`.
 *
 * A UI NÃO decide regra nenhuma: as fontes que autorizam, os espaços válidos, o
 * máximo de alvos (que muda com o espaço escolhido) e os requisitos espaciais
 * vêm de `GET /api/spells/cast-options`. O cliente manda apenas identificadores
 * + `operationId`; o servidor revalida tudo no commit.
 */
const MODE_LABELS: Record<string, string> = {
  known: 'conhecidas',
  'prepared-list': 'preparadas (lista da classe)',
  'spellbook-prepared': 'grimório + preparadas',
  explicit: 'statblock',
};

type Phase = 'idle' | 'configuring' | 'submitting' | 'awaiting-master';

interface SourceChoice {
  kind: string;
  id: string;
}

interface TargetChoice {
  kind: 'character' | 'creature';
  id: string;
  name: string;
}

interface Draft {
  options: CastOptions;
  /** Gerado UMA vez por tentativa: retry da mesma submissão reusa este id. */
  operationId: string;
  source: SourceChoice | null;
  resource: CastResourceOption | null;
  targets: TargetChoice[];
}

interface Feedback {
  kind: 'ok' | 'error' | 'info';
  text: string;
}

const targetKey = (target: { kind: string; id: string }) => `${target.kind}:${target.id}`;

export function SpellRepertoirePanel({ characterId }: { characterId: string }) {
  const [repertoire, setRepertoire] = useState<CharacterRepertoire | null>(null);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [planned, setPlanned] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Fluxo de conjuração (6.6F.1).
  const [phase, setPhase] = useState<Phase>('idle');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [intent, setIntent] = useState<SpellCastIntent | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

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
    setPlanned(
      new Set(
        source.entries
          .filter((entry) => entry.planned && !entry.alwaysPrepared)
          .map((entry) => entry.spellId),
      ),
    );
  }, [source]);

  // Recarregar a ficha NÃO pode perder a intenção: ela vive no servidor.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const pending = await listIntents();
        const own = pending.find(
          (item) => item.caster.kind === 'character' && item.caster.id === characterId,
        );
        if (alive && own) {
          setIntent(own);
          setPhase('awaiting-master');
        }
      } catch {
        // A fila é complementar: sem ela o fluxo de conjuração continua válido.
      }
    })();
    return () => {
      alive = false;
    };
  }, [characterId]);

  const intentIdRef = useRef<string | null>(null);
  intentIdRef.current = intent?.id ?? null;

  /** Estado TERMINAL vindo do servidor (aprovado, negado, cancelado, invalidado). */
  const settle = useCallback(
    (updated: SpellCastIntent) => {
      if (updated.status === 'pending') {
        setIntent(updated);
        setPhase('awaiting-master');
        return;
      }
      setIntent(null);
      setDraft(null);
      setPhase('idle');
      if (updated.status === 'committed') {
        setFeedback({ kind: 'ok', text: 'Conjuração confirmada pelo Mestre.' });
        void load();
        return;
      }
      if (updated.status === 'denied') {
        setFeedback({ kind: 'error', text: 'Conjuração não aprovada pelo Mestre.' });
        return;
      }
      if (updated.status === 'invalidated') {
        setFeedback({
          kind: 'error',
          text: updated.reason
            ? `A conjuração deixou de ser válida: ${updated.reason}`
            : 'A conjuração deixou de ser válida antes da confirmação. Você pode tentar de novo.',
        });
        void load();
        return;
      }
      setFeedback({ kind: 'info', text: 'Conjuração cancelada. Nada foi gasto.' });
    },
    [load],
  );

  useEffect(
    () =>
      subscribeSpellIntents((updated) => {
        if (updated.id !== intentIdRef.current) return;
        settle(updated);
      }),
    [settle],
  );

  async function openCast(spellId: string) {
    setFeedback(null);
    setNotice(null);
    try {
      const options = await fetchCastOptions(characterId, spellId);
      if (!options.spell.executable) {
        setFeedback({
          kind: 'error',
          text: 'Automação de conjuração ainda não implementada para esta magia.',
        });
        return;
      }
      if (options.sources.length === 0) {
        setFeedback({
          kind: 'error',
          text: 'Esta magia não está disponível para conjuração agora.',
        });
        return;
      }
      if (options.pendingIntent) {
        setIntent(options.pendingIntent);
        setPhase('awaiting-master');
        setFeedback({
          kind: 'info',
          text: 'Você já tem uma conjuração aguardando confirmação do Mestre.',
        });
        return;
      }
      setDraft({
        options,
        operationId: newId(),
        // Ambiguidade NUNCA é resolvida no cliente: só auto-seleciona o que é único.
        source:
          options.sources.length === 1
            ? { kind: options.sources[0].kind, id: options.sources[0].id }
            : null,
        resource: options.resources.length === 1 ? options.resources[0] : null,
        targets: [],
      });
      setPhase('configuring');
    } catch (caught) {
      setFeedback({ kind: 'error', text: castErrorMessage(caught) });
    }
  }

  function closeDraft() {
    if (phase === 'submitting') return;
    setDraft(null);
    setPhase('idle');
  }

  function pickSource(kind: string, id: string) {
    setDraft((current) => (current ? { ...current, source: { kind, id } } : current));
    setFeedback(null);
  }

  function pickResource(resource: CastResourceOption) {
    setDraft((current) => {
      if (!current) return current;
      // O máximo de alvos acompanha o espaço: alvos em excesso NÃO são removidos
      // silenciosamente — o submit fica bloqueado e o aviso aparece.
      return { ...current, resource };
    });
    setFeedback(null);
  }

  function toggleTarget(target: { kind: 'character' | 'creature'; id: string; name: string }) {
    setDraft((current) => {
      if (!current) return current;
      const key = targetKey(target);
      const exists = current.targets.some((item) => targetKey(item) === key);
      return {
        ...current,
        targets: exists
          ? current.targets.filter((item) => targetKey(item) !== key)
          : [...current.targets, { kind: target.kind, id: target.id, name: target.name }],
      };
    });
    setFeedback(null);
  }

  async function submit() {
    if (!draft) return;
    if (draft.options.sources.length > 1 && !draft.source) {
      setFeedback({ kind: 'error', text: 'Selecione uma fonte de conjuração.' });
      return;
    }
    const needsResource = draft.options.spell.level > 0;
    if (needsResource && !draft.resource) {
      setFeedback({ kind: 'error', text: 'Selecione um espaço de magia.' });
      return;
    }
    if (draft.targets.length < minTargets || draft.targets.length > maxTargets) {
      setFeedback({
        kind: 'error',
        text:
          maxTargets === 1
            ? 'Selecione 1 alvo.'
            : `Selecione de ${minTargets} a ${maxTargets} alvos.`,
      });
      return;
    }

    setPhase('submitting');
    try {
      const result = await castSpell({
        operationId: draft.operationId,
        spellId: draft.options.spell.id,
        caster: { kind: 'character', id: characterId },
        targets: draft.targets.map((target) => ({ kind: target.kind, id: target.id })),
        ...(draft.source ? { spellcastingSource: draft.source } : {}),
        ...(draft.resource
          ? { castingResource: { kind: draft.resource.kind, level: draft.resource.level } }
          : {}),
      });
      if (result.kind === 'cast') {
        setFeedback({ kind: 'ok', text: 'Conjuração realizada.' });
        setDraft(null);
        setPhase('idle');
        await load();
        return;
      }
      // Sem resposta espacial confiável o servidor NÃO gasta nada: aguarda o Mestre.
      setIntent(result.intent);
      setPhase('awaiting-master');
      setFeedback(null);
    } catch (caught) {
      setFeedback({ kind: 'error', text: castErrorMessage(caught) });
      setPhase('configuring');
      // Estado pode ter mudado (espaço, turno, preparação): recarrega o repertório.
      await load();
    }
  }

  async function cancelCurrentIntent() {
    if (!intent) return;
    try {
      settle(await cancelIntent(intent.id));
    } catch (caught) {
      setFeedback({ kind: 'error', text: castErrorMessage(caught) });
    }
  }

  if (error && !repertoire) return <p className="muted">{error}</p>;
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

  /* ---------------------------------------------------------------------- */
  /* Derivados do fluxo (tudo vem do servidor; aqui só se LÊ)                 */
  /* ---------------------------------------------------------------------- */
  const spellLevel = draft?.options.spell.level ?? 0;
  const needsResource = spellLevel > 0;
  const chosenResource =
    draft?.resource ??
    (draft && draft.options.resources.length === 1 ? draft.options.resources[0] : null);
  /** Nível visual do cast: consequência do espaço escolhido, nunca digitado. */
  const castAtLevel = needsResource ? (chosenResource?.level ?? spellLevel) : 0;
  const targeting: CastTargetingSummary | undefined =
    draft?.options.targeting.find((item) => item.castAtLevel === castAtLevel) ??
    draft?.options.targeting[0];
  const minTargets = targeting?.minTargets ?? 1;
  const maxTargets = targeting?.maxTargets ?? 1;
  const humanoidOnly = targeting?.filters.includes('creature-type:humanoid') ?? false;
  const targetPool = (draft?.options.targets ?? []).filter((target) =>
    humanoidOnly ? target.type === 'Humanoide' : true,
  );
  const sourceAmbiguous = (draft?.options.sources.length ?? 0) > 1;
  const resourceAmbiguous = (draft?.options.resources.length ?? 0) > 1;
  const targetCountInvalid =
    (draft?.targets.length ?? 0) < minTargets || (draft?.targets.length ?? 0) > maxTargets;
  const canSubmit =
    phase === 'configuring' &&
    Boolean(draft) &&
    (!sourceAmbiguous || Boolean(draft?.source)) &&
    (!needsResource || Boolean(chosenResource)) &&
    !targetCountInvalid;

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

      {feedback ? (
        <p className={feedback.kind === 'error' ? 'muted spell-cast-feedback-error' : 'muted'}>
          {feedback.text}
        </p>
      ) : null}

      {phase === 'awaiting-master' && intent ? (
        <div className="spell-cast-intent">
          <p>
            <strong>{intent.spellName}</strong> — aguardando confirmação do Mestre.
          </p>
          <p className="muted">
            Alvos: {intent.targets.map((target) => target.name || target.id).join(', ') || '—'}
          </p>
          <p className="muted">
            Nenhum espaço, Ação ou Concentração foi usada até o Mestre confirmar os requisitos
            que o servidor não consegue medir.
          </p>
          <button type="button" className="btn btn-small" onClick={() => void cancelCurrentIntent()}>
            Cancelar conjuração
          </button>
        </div>
      ) : null}

      {phase !== 'idle' && (phase === 'configuring' || phase === 'submitting') && draft ? (
        <div className="spell-cast-flow">
          <p>
            <strong>{draft.options.spell.name}</strong>{' '}
            <span className="muted">
              {spellLevel === 0 ? 'truque' : `nível ${spellLevel}`}
              {needsResource ? ` · conjurando no nível ${castAtLevel}` : ''}
              {targeting?.rangeFeet ? ` · alcance ${targeting.rangeFeet} pés` : ''}
            </span>
          </p>

          {sourceAmbiguous ? (
            <div>
              <p className="muted">Fonte de conjuração</p>
              {draft.options.sources.map((option) => (
                <label key={`${option.kind}:${option.id}`}>
                  <input
                    type="radio"
                    name={`cast-source-${draft.operationId}`}
                    checked={draft.source?.kind === option.kind && draft.source?.id === option.id}
                    onChange={() => pickSource(option.kind, option.id)}
                  />{' '}
                  {option.label}
                  {option.ability ? ` — ${option.ability.toUpperCase()}` : ''}
                  {option.spellSaveDc !== null ? ` — CD ${option.spellSaveDc}` : ''}
                </label>
              ))}
            </div>
          ) : null}

          {needsResource ? (
            resourceAmbiguous ? (
              <div>
                <p className="muted">Espaço de magia</p>
                {draft.options.resources.map((option) => (
                  <label key={`${option.kind}:${option.level}`}>
                    <input
                      type="radio"
                      name={`cast-resource-${draft.operationId}`}
                      checked={
                        chosenResource?.kind === option.kind && chosenResource?.level === option.level
                      }
                      onChange={() => pickResource(option)}
                    />{' '}
                    {option.label} — {option.remaining}/{option.max}
                  </label>
                ))}
              </div>
            ) : chosenResource ? (
              <p className="muted">
                Espaço: {chosenResource.label} — {chosenResource.remaining}/{chosenResource.max}
              </p>
            ) : (
              <p className="muted">Nenhum espaço válido disponível para esta magia.</p>
            )
          ) : null}

          <p className="muted">
            Alvos {draft.targets.length}/{maxTargets}
            {humanoidOnly ? ' · somente humanoides' : ''}
            {targeting?.requiresSight ? ' · requer visão' : ''}
          </p>
          {targetPool.length === 0 ? (
            <p className="muted">Nenhum alvo disponível.</p>
          ) : (
            <ul>
              {targetPool.map((target) => {
                const key = targetKey(target);
                return (
                  <li key={key}>
                    <label>
                      <input
                        type="checkbox"
                        checked={draft.targets.some((item) => targetKey(item) === key)}
                        onChange={() => toggleTarget(target)}
                      />{' '}
                      {target.name}
                      {target.isSelf ? ' (você)' : ''}{' '}
                      <span className="muted">{target.kind === 'creature' ? 'criatura' : 'ficha'}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          {targeting && targeting.requiresSight ? (
            <p className="muted">
              O servidor confirma visão e alcance: se não puder medir, o Mestre autoriza antes de
              qualquer custo.
            </p>
          ) : null}

          {targetCountInvalid && draft.targets.length > maxTargets ? (
            <p className="muted spell-cast-feedback-error">
              Este espaço permite até {maxTargets} alvo(s): remova {draft.targets.length - maxTargets}.
            </p>
          ) : null}

          <button
            type="button"
            className="btn btn-small"
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {phase === 'submitting' ? 'Conjurando…' : 'Conjurar'}
          </button>{' '}
          <button
            type="button"
            className="btn btn-small"
            disabled={phase === 'submitting'}
            onClick={closeDraft}
          >
            Fechar
          </button>
        </div>
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
                    <button
                      type="button"
                      className="btn btn-small"
                      disabled={!entry.active && !entry.alwaysPrepared && entry.level > 0}
                      title={
                        entry.active || entry.alwaysPrepared || entry.level === 0
                          ? 'Conjurar esta magia'
                          : 'A magia está no repertório, mas não está preparada.'
                      }
                      onClick={() => void openCast(entry.spellId)}
                    >
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
