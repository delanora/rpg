import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { answerRelentless, fetchDeath, overrideDeath } from '../deathApi';
import { useSheetAccess } from '../readonly';
import type { Character, DeathDto, MechanicalEntity } from '../types';

interface DeathPanelProps {
  character: Character;
  /**
   * Chave que muda quando a ficha OU o turno do combate mudam. A elegibilidade
   * do Teste contra a Morte depende do turno, então a leitura é refeita aqui.
   */
  refreshKey?: string;
  /** Abre a janela de dados com o d20 do Teste contra a Morte. */
  onRollDeathSave?: (entity: MechanicalEntity) => void;
}

/** Três marcas de sucesso/falha (PHB 2014). */
function Pips({ filled, kind }: { filled: number; kind: 'success' | 'failure' }) {
  return (
    <span className={`death-pips death-pips-${kind}`} aria-label={`${filled} de 3`}>
      {[0, 1, 2].map((index) => (
        <span key={index} className={index < filled ? 'death-pip filled' : 'death-pip'} />
      ))}
    </span>
  );
}

/**
 * Ciclo de MORTE na ficha (Fase 6.3).
 *
 * O sistema NUNCA declara morte sozinho: quando as regras indicam que o
 * personagem morreria, a ficha mostra "Aguardando resolução do Mestre" e só o
 * Mestre decide no painel dele. O Teste contra a Morte é rolado pelo jogador,
 * quando e se quiser, no início do próprio turno — nunca automaticamente.
 */
export function DeathPanel({ character, refreshKey, onRollDeathSave }: DeathPanelProps) {
  const access = useSheetAccess();
  const entity: MechanicalEntity = { kind: 'character', id: character.id };
  const [death, setDeath] = useState<DeathDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetchDeath(entity)
      .then((updated) => setDeath(updated))
      .catch(() => {
        // Sem leitura (ex.: sessão sem permissão): a ficha ainda mostra o estado
        // que veio no DTO dela.
        setDeath(null);
      });
  }, [character.id]);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey, character.version]);

  const state = death?.death ?? character.deathState;
  const relevant =
    state.dead ||
    state.pending !== null ||
    state.relentless !== null ||
    state.stabilized ||
    state.deathSaves ||
    state.successes > 0 ||
    state.failures > 0 ||
    character.hpCurrent <= 0;
  if (!relevant) return null;

  const expectedVersion = death?.version ?? character.version;

  const answer = async (choice: 'use' | 'decline') => {
    setBusy(true);
    setError(null);
    try {
      await answerRelentless({ entity, answer: choice, expectedVersion });
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao responder.');
    } finally {
      setBusy(false);
    }
  };

  const override = async (
    action: Parameters<typeof overrideDeath>[0]['action'],
    reason: string,
  ) => {
    setBusy(true);
    setError(null);
    try {
      await overrideDeath({ entity, action, expectedVersion, reason });
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha na ação do Mestre.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="death-panel" aria-label="Estado de morte">
      <header className="death-head">
        <Icon name="heart" size={16} />
        <strong>Estado de morte</strong>
        {state.dead ? <span className="death-tag dead">Morto</span> : null}
        {state.stabilized ? <span className="death-tag stabilized">Estabilizado</span> : null}
        {state.pending ? <span className="death-tag pending">Decisão do Mestre</span> : null}
      </header>

      {state.dead ? (
        <p className="death-text">
          O Mestre confirmou a morte. Este estado só muda por decisão explícita dele.
        </p>
      ) : null}

      {state.pending ? (
        <p className="death-text death-pending">
          {death?.pendingLabel ?? 'As regras indicam que o personagem morreria.'} —{' '}
          <strong>Aguardando resolução do Mestre.</strong>
        </p>
      ) : null}

      {!state.dead ? (
        <div className="death-counters">
          <span className="death-counter">
            Sucessos <Pips filled={state.successes} kind="success" />
          </span>
          <span className="death-counter">
            Falhas <Pips filled={state.failures} kind="failure" />
          </span>
        </div>
      ) : null}

      {state.stabilized ? (
        <p className="death-text">
          0 PV e estabilizado: sem novos Testes contra a Morte. Segue Inconsciente até
          recuperar PV.
        </p>
      ) : null}

      {state.relentless ? (
        <div className="death-relentless">
          <p className="death-text">
            <strong>Usar Resistência Implacável?</strong> Você cairia a 0 PV: pode ficar com 1
            PV em vez disso (uma vez por descanso longo).
          </p>
          <div className="death-actions">
            <button
              type="button"
              className="death-button primary"
              disabled={busy || access.readOnly}
              onClick={() => void answer('use')}
            >
              Usar
            </button>
            <button
              type="button"
              className="death-button"
              disabled={busy || access.readOnly}
              onClick={() => void answer('decline')}
            >
              Não usar
            </button>
          </div>
        </div>
      ) : null}

      {!state.dead && !state.pending && !state.relentless && state.deathSaves ? (
        <div className="death-actions">
          <button
            type="button"
            className="death-button"
            disabled={!death?.deathSave.available || !onRollDeathSave}
            onClick={() => onRollDeathSave?.(entity)}
          >
            Rolar Teste contra a Morte
          </button>
          {!death?.deathSave.available && death?.deathSave.reason ? (
            <span className="death-hint">{death.deathSave.reason}</span>
          ) : null}
        </div>
      ) : null}

      {access.masterView && !state.pending ? (
        <div className="death-actions death-admin">
          <button type="button" className="death-button" disabled={busy} onClick={() => void override('add-success', 'Ajuste do Mestre')}>
            + sucesso
          </button>
          <button type="button" className="death-button" disabled={busy} onClick={() => void override('remove-success', 'Ajuste do Mestre')}>
            − sucesso
          </button>
          <button type="button" className="death-button" disabled={busy} onClick={() => void override('add-failure', 'Ajuste do Mestre')}>
            + falha
          </button>
          <button type="button" className="death-button" disabled={busy} onClick={() => void override('remove-failure', 'Ajuste do Mestre')}>
            − falha
          </button>
          {!state.stabilized ? (
            <button
              type="button"
              className="death-button"
              disabled={busy || character.hpCurrent > 0}
              onClick={() => void override('stabilize', 'Estabilização assistida pelo Mestre')}
            >
              Estabilizar
            </button>
          ) : (
            <button type="button" className="death-button" disabled={busy} onClick={() => void override('unstabilize', 'Mestre removeu a estabilização')}>
              Remover estabilização
            </button>
          )}
          <button type="button" className="death-button" disabled={busy} onClick={() => void override('revive', 'Reversão explícita do Mestre')}>
            Reviver (1 PV)
          </button>
        </div>
      ) : null}

      {error ? <p className="death-error">{error}</p> : null}
    </section>
  );
}
