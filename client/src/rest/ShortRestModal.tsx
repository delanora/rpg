import { useCallback, useEffect, useRef, useState } from 'react';
import { formatModifier } from '../dnd';
import { HpBar } from '../components/HpBar';
import { Icon } from '../components/Icon';
import type { Character } from '../types';
import { HitDicePanel } from './HitDicePanel';
import { ShortRestParticipants } from './ShortRestParticipants';
import { ShortRestResultView } from './ShortRestResultView';
import type { SpendHitDieResult } from './restApi';
import type { ShortRestController } from './useShortRest';

/**
 * O painel ÚNICO e persistente do Descanso Curto.
 *
 * Não existe uma página separada nem vários modais desconectados: o mesmo
 * componente reconstrói a experiência a partir do estado da solicitação
 * (nenhum descanso → aguardando → em andamento → concluído/cancelado). A ficha
 * segue visível atrás.
 *
 * O frontend só apresenta o estado e envia intenções; quem participa, quem está
 * pronto, qual Canção de Descanso usar e quanto curar são decisões do servidor.
 *
 * Ciclo do estado resolvido: COMPLETED/CANCELLED continuam visíveis até o
 * usuário fechar; fechar passa por `close()` e descarta o estado resolvido no
 * hook (ver `dismissResolved`), então o próximo clique abre o fluxo inicial sem
 * F5. Fechar um descanso VIVO (PENDING/APPROVED) preserva tudo.
 */
export function ShortRestModal({
  open,
  onClose,
  rest,
  character,
  characters,
  isMaster = false,
}: {
  open: boolean;
  onClose: () => void;
  rest: ShortRestController;
  character?: Character;
  /** Fichas da mesa (só no painel do MESTRE) — retrato/classe dos participantes. */
  characters?: Character[];
  isMaster?: boolean;
}) {
  const { request, completion, error, pending } = rest;
  const [confirm, setConfirm] = useState<null | 'force-approve' | 'force-complete' | 'cancel'>(
    null,
  );
  const [spendingDie, setSpendingDie] = useState<number | null>(null);
  const [lastRoll, setLastRoll] = useState<SpendHitDieResult | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  /**
   * Fechar o painel: além do estado local abaixo, descarta a solicitação JÁ
   * RESOLVIDA que ainda estava na tela. O resultado fica visível até o usuário
   * fechar (nada some na conclusão) e um descanso em andamento é preservado.
   */
  const close = useCallback(() => {
    rest.dismissResolved();
    onClose();
  }, [onClose, rest.dismissResolved]);

  // Ao fechar, esquece confirmações e a última rolagem (o estado real vive no
  // servidor; reabrir reconstrói tudo do GET/eventos).
  useEffect(() => {
    if (open) return;
    setConfirm(null);
    setSpendingDie(null);
    setLastRoll(null);
  }, [open]);

  // Esc fecha quando é seguro: nunca no meio de uma ação; a confirmação fecha
  // sozinha primeiro.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (confirm !== null) {
        setConfirm(null);
        return;
      }
      if (pending === null) close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, confirm, pending, close]);

  // Foco inicial no painel (o leitor de tela anuncia o título; o Tab segue daqui).
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  if (!open) return null;

  // 5.2.7B: fichas conhecidas para retrato/classe (Mestre: mesa; jogador: a própria).
  const knownCharacters = characters ?? (character ? [character] : undefined);

  const me = request?.participants.find((participant) => participant.characterId === character?.id);
  const requesterName = request?.requestedBy.displayName ?? 'Alguém';
  const iAsked = request?.requestedBy.userId != null && me?.userId === request.requestedBy.userId;
  const busy = pending !== null;

  async function spend(die: number): Promise<void> {
    if (!character) return;
    setSpendingDie(die);
    const result = await rest.spendHitDie(die, character.version);
    if (result) setLastRoll(result);
    setSpendingDie(null);
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Descanso Curto">
      <div className="modal short-rest-modal" ref={dialogRef} tabIndex={-1}>
        <header className="short-rest-header">
          <h2>
            <Icon name="flame" size={20} /> Descanso Curto
          </h2>
          <button
            type="button"
            className="levelup-close"
            title="Fechar (Esc)"
            aria-label="Fechar o painel de Descanso Curto"
            onClick={close}
          >
            <Icon name="x" size={15} />
          </button>
        </header>

        {error ? (
          <div className="form-error short-rest-error" role="alert">
            {error}
            <button type="button" className="btn btn-small" onClick={rest.clearError}>
              ok
            </button>
          </div>
        ) : null}

        {/* ---- Nenhum descanso ativo ------------------------------------- */}
        {!request && !isMaster && character ? (
          <div className="short-rest-idle">
            <p className="short-rest-lead">Recupere forças durante uma pausa.</p>
            <ul className="short-rest-summary">
              <li>
                <span>Pontos de vida</span>
                <strong>
                  {character.hpCurrent} / {character.derived.hpMax}
                </strong>
              </li>
              <li>
                <span>Dados de Vida restantes</span>
                <strong>
                  {character.derived.hitDice.remaining} de {character.derived.hitDice.total}
                </strong>
              </li>
            </ul>

            {shortRestResources(character).length > 0 ? (
              <>
                <h3 className="subsection-title">Recuperam neste descanso</h3>
                <ul className="short-rest-resources">
                  {shortRestResources(character).map((resource) => (
                    <li key={resource.id}>
                      <span>{resource.name}</span>
                      <span className="muted">
                        {resource.unlimited ? '∞' : `${resource.remaining}/${resource.max}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="section-note">
                Sua classe não tem recursos que recarregam num Descanso Curto, mas você pode
                pausar e gastar Dados de Vida.
              </p>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void rest.create()}
              >
                {pending === 'create' ? 'solicitando…' : 'Solicitar Descanso Curto'}
              </button>
            </div>
          </div>
        ) : null}

        {!request && isMaster ? (
          <p className="section-note">Nenhuma solicitação de Descanso Curto em andamento.</p>
        ) : null}

        {/* ---- PENDING --------------------------------------------------- */}
        {request?.status === 'PENDING' ? (
          <div className="short-rest-pending">
            <p className="short-rest-lead">
              {iAsked ? 'Você solicitou um Descanso Curto.' : `${requesterName} propôs uma pausa.`}
            </p>

            {!isMaster && me?.response === 'PENDING' ? (
              <>
                <p>Deseja participar deste descanso?</p>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => void rest.respond('ACCEPTED')}
                  >
                    Participar
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void rest.respond('DECLINED')}
                  >
                    Não participar
                  </button>
                </div>
              </>
            ) : null}

            {!isMaster && me?.response === 'ACCEPTED' ? (
              <div className="short-rest-decision">
                <p>
                  <strong>Você escolheu participar.</strong> Enquanto a mesa decide, pode mudar de
                  ideia.
                </p>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy}
                  onClick={() => void rest.respond('DECLINED')}
                >
                  Alterar para não participar
                </button>
              </div>
            ) : null}

            {!isMaster && me?.response === 'DECLINED' ? (
              <div className="short-rest-decision">
                <p>
                  <strong>Você não está participando deste Descanso Curto.</strong>
                </p>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy}
                  onClick={() => void rest.respond('ACCEPTED')}
                >
                  Participar afinal
                </button>
              </div>
            ) : null}

            {isMaster ? <p className="section-note">Aguardando a resposta da mesa.</p> : null}

            <h3 className="subsection-title">Quem foi convidado</h3>
            <ShortRestParticipants
              participants={request.participants}
              status={request.status}
              myCharacterId={character?.id}
              characters={knownCharacters}
            />

            {isMaster ? (
              confirm === 'force-approve' ? (
                <ConfirmStrip
                  message="Jogadores que ainda não responderam ficarão fora deste descanso."
                  confirmLabel="Forçar início"
                  busy={pending === 'force-approve'}
                  onBack={() => setConfirm(null)}
                  onConfirm={() => void rest.forceApprove()}
                />
              ) : confirm === 'cancel' ? (
                <ConfirmStrip
                  message="Cancelar a solicitação de Descanso Curto?"
                  confirmLabel="Cancelar solicitação"
                  busy={pending === 'cancel'}
                  onBack={() => setConfirm(null)}
                  onConfirm={() => void rest.cancel()}
                />
              ) : (
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => setConfirm('force-approve')}
                  >
                    Forçar início
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busy}
                    onClick={() => setConfirm('cancel')}
                  >
                    Cancelar solicitação
                  </button>
                </div>
              )
            ) : null}
          </div>
        ) : null}

        {/* ---- APPROVED (em andamento) ----------------------------------- */}
        {request?.status === 'APPROVED' && isMaster ? (
          <div className="short-rest-active">
            <p className="short-rest-lead">Descanso Curto em andamento.</p>
            <h3 className="subsection-title">Mesa</h3>
            <ShortRestParticipants
              participants={request.participants}
              status={request.status}
              characters={knownCharacters}
            />
            {confirm === 'force-complete' ? (
              <ConfirmStrip
                message="Participantes que ainda não marcaram “Pronto” terão o descanso encerrado agora."
                confirmLabel="Finalizar agora"
                busy={pending === 'force-complete'}
                onBack={() => setConfirm(null)}
                onConfirm={() => void rest.forceComplete()}
              />
            ) : (
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => setConfirm('force-complete')}
                >
                  Finalizar agora
                </button>
              </div>
            )}
          </div>
        ) : null}

        {request?.status === 'APPROVED' && !isMaster && character && me?.response === 'ACCEPTED' ? (
          <div className="short-rest-active">
            <div className="short-rest-hp">
              <span className="short-rest-stat-label">Pontos de vida</span>
              <HpBar
                current={character.hpCurrent}
                max={character.derived.hpMax}
                temp={character.hpTemp}
                showLabel={false}
              />
              <strong className="short-rest-stat-value">
                {character.hpCurrent} / {character.derived.hpMax}
              </strong>
            </div>

            <h3 className="subsection-title">Dados de Vida</h3>
            <HitDicePanel
              hitDice={character.derived.hitDice}
              disabled={me.ready || busy}
              spendingDie={spendingDie}
              onSpend={(die) => void spend(die)}
            />

            {lastRoll ? <RollFeedback result={lastRoll} /> : null}

            {me.ready ? (
              <div className="short-rest-decision">
                <p>
                  <strong>✓ Preparativos concluídos.</strong> Este estado é só seu — o descanso
                  termina quando todos ficarem prontos.
                </p>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy}
                  onClick={() => void rest.setReady(false)}
                >
                  Ainda quero gastar Dados de Vida
                </button>
              </div>
            ) : (
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void rest.setReady(true)}
                >
                  {pending === 'ready' ? 'marcando…' : 'Estou pronto'}
                </button>
              </div>
            )}

            <h3 className="subsection-title">Mesa</h3>
            <ShortRestParticipants
              participants={request.participants}
              status={request.status}
              myCharacterId={character.id}
              characters={knownCharacters}
            />
          </div>
        ) : null}

        {/* Descanso em andamento, mas o jogador não participa. */}
        {request?.status === 'APPROVED' && !isMaster && (!me || me.response === 'DECLINED') ? (
          <div className="short-rest-pending">
            <p className="short-rest-decision">
              <strong>Você não está participando deste Descanso Curto.</strong>
            </p>
            <p className="section-note">Você pode acompanhar o andamento da mesa.</p>
            <h3 className="subsection-title">Mesa</h3>
            <ShortRestParticipants
              participants={request.participants}
              status={request.status}
              myCharacterId={character?.id}
              characters={knownCharacters}
            />
          </div>
        ) : null}

        {/* ---- COMPLETED ------------------------------------------------- */}
        {request?.status === 'COMPLETED' && character ? (
          <ShortRestResultView
            request={request}
            completion={completion}
            character={character}
            onClose={close}
          />
        ) : null}

        {request?.status === 'COMPLETED' && !character ? (
          <div>
            <p className="short-rest-lead">O Descanso Curto coletivo foi concluído.</p>
            {completion?.songOfRest.rolls.length ? (
              <>
                <h3 className="subsection-title">Canção de Descanso</h3>
                <ul className="short-rest-summary">
                  {completion.songOfRest.rolls.map((roll) => (
                    <li key={roll.characterId}>
                      <span>1d{roll.die} [{roll.value}]</span>
                      <strong>+{roll.actualHealed} PV</strong>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={close}>
                Fechar
              </button>
            </div>
          </div>
        ) : null}

        {/* ---- CANCELLED ------------------------------------------------- */}
        {request?.status === 'CANCELLED' ? (
          <div>
            <p className="short-rest-lead">Descanso Curto cancelado.</p>
            {request.cancelReason === 'NO_PARTICIPANTS' ? (
              <p className="section-note">Ninguém aceitou o convite.</p>
            ) : null}
            <h3 className="subsection-title">Status da mesa</h3>
            <ShortRestParticipants
              participants={request.participants}
              status={request.status}
              myCharacterId={character?.id}
              characters={knownCharacters}
            />
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={close}>
                Fechar
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Recursos que recarregam num Descanso Curto (regra do servidor, só exibição). */
function shortRestResources(character: Character) {
  return character.classAdjustments.resources.filter((resource) => resource.recharge === 'short');
}

/** Feedback da última rolagem de Dado de Vida, no mesmo painel (sem novo modal). */
function RollFeedback({ result }: { result: SpendHitDieResult }) {
  const { roll, hp } = result;
  const wasted = roll.healing - roll.actualHealed;
  return (
    <div className="short-rest-roll" aria-live="polite">
      <span className="short-rest-roll-title">Última rolagem</span>
      <span>
        <strong>1d{roll.die}</strong> [{roll.value}] {formatModifier(roll.conMod)} ={' '}
        <strong>{roll.healing}</strong>
      </span>
      <span>
        PV: {hp.before} → {hp.after} / {hp.max}
      </span>
      {wasted > 0 ? (
        <span className="muted">
          Cura efetiva: +{roll.actualHealed} PV · {wasted} PV excedentes ignorados pelo máximo.
        </span>
      ) : null}
    </div>
  );
}

/** Confirmação embutida (sem abrir um segundo modal). */
function ConfirmStrip({
  message,
  confirmLabel,
  busy,
  onBack,
  onConfirm,
}: {
  message: string;
  confirmLabel: string;
  busy: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="short-rest-confirm" role="alertdialog" aria-label="Confirmação">
      <p>{message}</p>
      <div className="modal-actions">
        <button type="button" className="btn btn-small" disabled={busy} onClick={onBack}>
          Voltar
        </button>
        <button
          type="button"
          className="btn btn-small btn-primary"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? 'aplicando…' : confirmLabel}
        </button>
      </div>
    </div>
  );
}
