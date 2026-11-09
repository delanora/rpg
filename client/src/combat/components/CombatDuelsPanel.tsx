import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/Icon';
import type { CombatDto, CombatDuelDto, SessionUser } from '../../types';
import {
  decideCombatDuel,
  fetchActiveCombat,
  fetchCombatDuels,
  requestCombatDuel,
} from '../combatApi';
import './duels.css';

/** Convites próprios são relidos por HTTP após a notificação de versão do combate. */
export function CombatDuelsPanel({
  combat,
  user,
  onCombatChange,
  onError,
}: {
  combat: CombatDto;
  user: SessionUser;
  onCombatChange: (combat: CombatDto | null) => void;
  onError: (message: string) => void;
}) {
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const [duels, setDuels] = useState<CombatDuelDto[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [targetId, setTargetId] = useState('');
  const own = combat.combatants.find(
    (unit) =>
      unit.kind === 'CHARACTER' &&
      unit.ownerUserId === user.id &&
      !unit.missing,
  );
  const master = user.role === 'MASTER';
  useEffect(() => {
    if (combat.status !== 'ACTIVE' || (!master && !own)) return;
    let active = true;
    void fetchCombatDuels(combat.id)
      .then((rows) => {
        if (active) setDuels(rows);
      })
      .catch((err) => {
        if (active)
          onError(
            err instanceof Error ? err.message : 'Falha ao consultar duelos.',
          );
      });
    return () => {
      active = false;
    };
  }, [
    combat.id,
    combat.version,
    combat.status,
    user.id,
    master,
    own?.id,
    onError,
  ]);
  const incoming = duels.filter(
    (duel) => duel.status === 'pending' && duel.challengedId === own?.id,
  );
  const incomingKey = incoming.map((duel) => duel.id).join(':');
  useEffect(() => {
    if (incomingKey) setOpen(true);
  }, [incomingKey]);
  if (combat.status !== 'ACTIVE' || (!master && !own)) return null;
  const choices = combat.combatants.filter(
    (unit) =>
      unit.kind === 'CHARACTER' &&
      unit.ownerUserId &&
      unit.ownerUserId !== user.id &&
      !unit.missing,
  );
  const alreadyOpen =
    !!targetId &&
    duels.some(
      (duel) =>
        [duel.requesterId, duel.challengedId].includes(own?.id ?? '') &&
        [duel.requesterId, duel.challengedId].includes(targetId),
    );
  async function run(action: () => Promise<CombatDto>) {
    setBusy(true);
    try {
      const updated = await action();
      if (!live.current) return;
      onCombatChange(updated);
      const rows = await fetchCombatDuels(updated.id);
      if (live.current) setDuels(rows);
    } catch (err) {
      if (!live.current) return;
      onError(
        err instanceof Error ? err.message : 'Falha na operação de duelo.',
      );
      try {
        const latest = await fetchActiveCombat();
        if (live.current) onCombatChange(latest);
      } catch {
        /* Preserva o erro original. */
      }
    } finally {
      if (live.current) setBusy(false);
    }
  }
  const decide = (
    duel: CombatDuelDto,
    decision: 'accept' | 'decline' | 'cancel' | 'end',
  ) => void run(() => decideCombatDuel(combat, duel.id, decision));
  const name = (id: string) =>
    combat.combatants.find((unit) => unit.id === id)?.name ??
    'Personagem ausente';
  return createPortal(
    <>
      <button
        type="button"
        className={`combat-duels-launcher${master ? ' is-master' : ''}${open ? ' active' : ''}`}
        title={open ? 'Fechar duelos' : 'Abrir duelos'}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="sword" size={17} />
        <span className="combat-duels-label">Duelos{duels.length ? ` (${duels.length})` : ''}</span>
      </button>
      {open ? (
        <aside
          className={`combat-duels-panel${master ? ' is-master' : ''}`}
          role="dialog"
          aria-label="Duelos entre jogadores"
        >
          <header>
            <h3>Duelos entre jogadores</h3>
            <button
              className="btn btn-small"
              type="button"
              onClick={() => setOpen(false)}
            >
              Fechar
            </button>
          </header>
          <p>
            O aceite habilita hostilidade e ataques de oportunidade só entre os
            dois. Ataques manuais continuam disponíveis e causam dano
            normalmente. Aceitar ou encerrar não recupera PV nem recursos.
          </p>
          {!master && own ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (targetId && !alreadyOpen)
                  void run(() => requestCombatDuel(combat, own.id, targetId));
              }}
            >
              <label>
                Desafiar jogador
                <select
                  aria-label="Jogador desafiado"
                  value={targetId}
                  disabled={busy}
                  onChange={(event) => setTargetId(event.target.value)}
                >
                  <option value="">Escolha um personagem</option>
                  {choices.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                className="btn btn-small"
                disabled={
                  busy ||
                  !choices.some((unit) => unit.id === targetId) ||
                  alreadyOpen
                }
              >
                Solicitar duelo
              </button>
              {alreadyOpen ? (
                <small>Já existe um convite ou duelo entre vocês.</small>
              ) : null}
            </form>
          ) : (
            <p className="section-note">
              O Mestre pode cancelar convites e encerrar duelos. O aceite
              pertence ao jogador desafiado.
            </p>
          )}
          <div className="combat-duels-list">
            {!duels.length ? (
              <p>Nenhum convite ou duelo aberto.</p>
            ) : (
              duels.map((duel) => {
                const recipient = !master && duel.challengedId === own?.id;
                return (
                  <article key={duel.id}>
                    <strong>
                      {name(duel.requesterId)} × {name(duel.challengedId)}
                    </strong>
                    <p>
                      {duel.status === 'active'
                        ? 'Duelo em andamento'
                        : recipient
                          ? 'Você recebeu um convite de duelo.'
                          : 'Aguardando o jogador desafiado.'}
                    </p>
                    <div className="combat-duels-actions">
                      {duel.status === 'active' ? (
                        <button
                          type="button"
                          className="btn btn-small"
                          disabled={busy}
                          onClick={() => decide(duel, 'end')}
                        >
                          Encerrar duelo
                        </button>
                      ) : recipient ? (
                        <>
                          <button
                            type="button"
                            className="btn btn-primary btn-small"
                            disabled={busy}
                            onClick={() => decide(duel, 'accept')}
                          >
                            Aceitar duelo
                          </button>
                          <button
                            type="button"
                            className="btn btn-small"
                            disabled={busy}
                            onClick={() => decide(duel, 'decline')}
                          >
                            Recusar
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-small"
                          disabled={busy}
                          onClick={() => decide(duel, 'cancel')}
                        >
                          Cancelar convite
                        </button>
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </aside>
      ) : null}
    </>,
    document.body,
  );
}
