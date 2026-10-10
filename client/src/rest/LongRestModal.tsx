import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { HpBar } from '../components/HpBar';
import { setCampSupplies } from '../gameApi';
import type { Character } from '../types';
import { CampSuppliesPanel } from './CampSuppliesPanel';
import { CampSupplyOverrideDialog } from './CampSupplyOverrideDialog';
import { CampSupplySuggestions } from './CampSupplySuggestions';
import { LongRestHitDicePanel } from './LongRestHitDicePanel';
import { LongRestParticipants } from './LongRestParticipants';
import { LongRestResultView } from './LongRestResultView';
import type { LongRestController } from './useLongRest';

/**
 * O painel ÚNICO e persistente do Descanso Longo coletivo.
 *
 * Não é um wizard: as etapas (Solicitação → Participação → Preparativos →
 * Descanso → Resultado) são mostradas como um trilho de progresso e o MESMO
 * painel se reconstrói a partir do estado do servidor — assim o realtime não
 * quebra o fluxo de ninguém. A ficha segue visível atrás.
 *
 * O frontend só apresenta o estado e envia intenções: quem participa, quem está
 * pronto, quantos Dados de Vida recuperar, quanto os suprimentos somam, se o
 * descanso conclui e o que foi consumido são decisões do SERVIDOR.
 *
 * `Recursos de Acampamento` é uma regra OPCIONAL (inspirada em BG3), nunca
 * apresentada como regra oficial do PHB 2014.
 */
const STEPS = ['Solicitação', 'Participação', 'Preparativos', 'Descanso', 'Resultado'];

type ConfirmKind =
  | 'force-approve'
  | 'cancel'
  | 'abort'
  | 'force-complete'
  | 'override-narrative'
  | 'override-administrative';

export function LongRestModal({
  open,
  onClose,
  rest,
  character,
  isMaster = false,
}: {
  open: boolean;
  onClose: () => void;
  rest: LongRestController;
  /** Ficha do jogador (ausente no painel do mestre). */
  character?: Character;
  isMaster?: boolean;
}) {
  const { request, completion, error, pending, me } = rest;
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [supplyItemId, setSupplyItemId] = useState<string | null>(null);
  // Configuração da mesa (só mestre): editor compacto dentro do descanso, para
  // não obrigar a sair do fluxo (a aba "Configurações da mesa" também tem o card).
  const [configOpen, setConfigOpen] = useState(false);
  const [costDraft, setCostDraft] = useState('');
  const [configBusy, setConfigBusy] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  /**
   * Fechar o painel: além do estado local abaixo, descarta a solicitação JÁ
   * RESOLVIDA que ainda estava na tela. O resultado (COMPLETED/CANCELLED)
   * continua visível até o usuário fechar — só então o estado ativo é limpo, e o
   * próximo clique volta ao fluxo inicial em vez de mostrar o descanso antigo.
   * Uma solicitação viva (PENDING/APPROVED) é preservada pelo hook.
   */
  const close = useCallback(() => {
    rest.dismissResolved();
    onClose();
  }, [onClose, rest.dismissResolved]);

  // Ao fechar, esquece confirmações e painéis locais (o estado real vive no
  // servidor; reabrir reconstrói tudo do GET/eventos).
  useEffect(() => {
    if (open) return;
    setConfirm(null);
    setSuggestionsOpen(false);
    setSupplyItemId(null);
    setConfigOpen(false);
    setConfigError(null);
    setNotice(null);
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

  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!configOpen) return;
    setCostDraft(String(request?.campSupplies.costPerParticipant ?? 10));
  }, [configOpen, request?.campSupplies.costPerParticipant]);

  if (!open) return null;

  const busy = pending !== null;
  const supplies = request?.campSupplies ?? null;
  const requesterName = request?.requestedBy.displayName ?? 'Alguém';
  const iAsked = me !== null && request !== null && me.userId === request.requestedBy.userId;
  const acceptedCount = request?.participants.filter((p) => p.response === 'ACCEPTED').length ?? 0;
  const waitingCount =
    request?.participants.filter((p) => p.response === 'ACCEPTED' && !p.ready).length ?? 0;
  const declined = request?.participants.filter((p) => p.response === 'DECLINED') ?? [];

  /** Trilho de etapas derivado do estado do servidor. */
  const stage = !request
    ? 1
    : request.status === 'PENDING'
      ? 2
      : request.status === 'APPROVED'
        ? request.allReady
          ? 4
          : 3
        : 5;

  const names: Record<string, string> = {};
  for (const participant of request?.participants ?? []) {
    names[participant.characterId] = participant.displayName;
  }

  async function saveSupply(inventoryItemId: string, quantity: number): Promise<void> {
    setSupplyItemId(inventoryItemId);
    await rest.setSupply(inventoryItemId, quantity);
    setSupplyItemId(null);
  }

  async function saveCampSupplies(input: {
    enabled?: boolean;
    costPerParticipant?: number;
  }): Promise<void> {
    setConfigBusy(true);
    setConfigError(null);
    try {
      await setCampSupplies(input);
      setNotice(
        input.enabled === undefined
          ? 'Custo por participante atualizado.'
          : input.enabled
            ? 'Recursos de Acampamento ativados.'
            : 'Recursos de Acampamento desativados.',
      );
    } catch (err) {
      setConfigError(
        err instanceof Error ? err.message : 'Não foi possível salvar a configuração.',
      );
    } finally {
      setConfigBusy(false);
    }
  }

  function commitCost(): void {
    const parsed = Number(costDraft);
    const current = request?.campSupplies.costPerParticipant ?? 10;
    if (!Number.isFinite(parsed) || parsed < 1) {
      setCostDraft(String(current));
      return;
    }
    const clamped = Math.min(1000, Math.max(1, Math.floor(parsed)));
    setCostDraft(String(clamped));
    if (clamped !== current) void saveCampSupplies({ costPerParticipant: clamped });
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Descanso Longo"
    >
      <div className="modal long-rest-modal" ref={dialogRef} tabIndex={-1}>
        <header className="short-rest-header">
          <h2>
            <Icon name="bed" size={20} /> Descanso Longo
          </h2>
          <button
            type="button"
            className="levelup-close"
            title="Fechar (Esc)"
            aria-label="Fechar o painel de Descanso Longo"
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

        {notice ? (
          <div className="banner banner-info" role="status">
            <span className="banner-line">{notice}</span>
            <button type="button" className="btn btn-small" onClick={() => setNotice(null)}>
              fechar
            </button>
          </div>
        ) : null}

        {/* Trilho das etapas — só faz sentido com uma solicitação viva. */}
        {request && request.status !== 'CANCELLED' ? (
          <ol className="rest-steps" aria-label="Etapas do Descanso Longo">
            {STEPS.map((label, index) => {
              const position = index + 1;
              const state =
                position < stage ? 'is-done' : position === stage ? 'is-current' : 'is-todo';
              return (
                <li key={label} className={`rest-step ${state}`}>
                  <span className="rest-step-index">{position}</span>
                  <span className="rest-step-label">{label}</span>
                </li>
              );
            })}
          </ol>
        ) : null}

        {/* ---- Nenhum descanso ativo ------------------------------------- */}
        {!request && !isMaster && character ? (
          <div className="short-rest-idle">
            <p className="short-rest-lead">
              Um Descanso Longo recupera tudo: pontos de vida, Dados de Vida, espaços de magia,
              Magia de Pacto e recursos de classe.
            </p>
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

            {longRestResources(character).length > 0 ? (
              <>
                <h3 className="subsection-title">Recuperam neste descanso</h3>
                <ul className="short-rest-resources">
                  {longRestResources(character).map((resource) => (
                    <li key={resource.id}>
                      <span>{resource.name}</span>
                      <span className="muted">
                        {resource.remaining}/{resource.max}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="section-note">
                Sua ficha não tem recursos de recarga longa listados, mas PV, Dados de Vida e
                espaços de magia voltam ao máximo.
              </p>
            )}

            <p className="section-note">
              O Descanso Longo é coletivo: a mesa responde, cada um faz seus preparativos e o
              servidor conclui quando todos estiverem prontos.
            </p>

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void rest.create()}
              >
                {pending === 'create' ? 'solicitando…' : 'Solicitar Descanso Longo'}
              </button>
            </div>
          </div>
        ) : null}

        {!request && isMaster ? (
          <div className="short-rest-idle">
            <p className="section-note">
              Nenhuma solicitação de Descanso Longo em andamento.
            </p>
            <p className="section-note">
              Os <strong>Recursos de Acampamento</strong> (regra opcional) são configurados em
              Configurações da mesa → Descanso.
            </p>
          </div>
        ) : null}

        {/* ---- PENDING: solicitação e participação ------------------------ */}
        {request?.status === 'PENDING' ? (
          <div className="short-rest-pending">
            <p className="short-rest-lead">
              {iAsked ? 'Você solicitou um Descanso Longo.' : `${requesterName} propôs um Descanso Longo.`}
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
                  <strong>Você não está participando deste Descanso Longo.</strong>
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

            {!isMaster && !me ? (
              <p className="section-note">
                Você não foi convidado para este descanso — apenas acompanha o andamento.
              </p>
            ) : null}

            {isMaster ? (
              <p className="section-note">
                Aguardando a resposta da mesa. Quem não responder fica de fora se você começar
                agora.
              </p>
            ) : null}

            <h3 className="subsection-title">Quem foi convidado</h3>
            <LongRestParticipants request={request} myCharacterId={character?.id} />

            {isMaster ? (
              confirm === 'force-approve' ? (
                <ConfirmStrip
                  message="Jogadores que ainda não responderam não participarão deste descanso."
                  confirmLabel="Começar descanso"
                  busy={pending === 'force-approve'}
                  onBack={() => setConfirm(null)}
                  onConfirm={() => void rest.forceApprove()}
                />
              ) : confirm === 'cancel' ? (
                <ConfirmStrip
                  message="Cancelar a solicitação de Descanso Longo?"
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
                    Começar com quem aceitou
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

        {/* ---- APPROVED: preparativos e descanso -------------------------- */}
        {request?.status === 'APPROVED' && isMaster ? (
          <div className="short-rest-active">
            <p className="short-rest-lead">Preparativos do descanso.</p>
            <p className="section-note">
              {waitingCount > 0
                ? `${waitingCount} participante(s) ainda preparando.`
                : 'Todos os participantes terminaram os preparativos.'}
            </p>

            <h3 className="subsection-title">Participantes</h3>
            <LongRestParticipants request={request} myCharacterId={character?.id} />

            {supplies ? (
              <>
                <h3 className="subsection-title">Recursos de Acampamento</h3>
                <CampSuppliesPanel supplies={supplies} names={names} />
                <div className="long-rest-config">
                  <p className="section-note">
                    {supplies.enabled
                      ? `Ativados · ${supplies.costPerParticipant} por participante.`
                      : 'Desativados — o descanso não exige recursos.'}
                  </p>
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={configBusy}
                    onClick={() => setConfigOpen((value) => !value)}
                  >
                    {configOpen ? 'Fechar configuração' : 'Alterar configuração'}
                  </button>
                </div>

                {configOpen ? (
                  <div className="long-rest-config-editor">
                    <label className="field field-check">
                      <input
                        type="checkbox"
                        checked={supplies.enabled}
                        disabled={configBusy}
                        onChange={(event) =>
                          void saveCampSupplies({ enabled: event.target.checked })
                        }
                      />
                      <span>USAR RECURSOS DE ACAMPAMENTO (REGRA OPCIONAL)</span>
                    </label>
                    <label className="field">
                      <span>CUSTO POR PARTICIPANTE</span>
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        value={costDraft}
                        disabled={configBusy || !supplies.enabled}
                        onChange={(event) => setCostDraft(event.target.value)}
                        onBlur={commitCost}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur();
                        }}
                      />
                    </label>
                    {configError ? <p className="config-empty-error">{configError}</p> : null}
                  </div>
                ) : null}

                {/* Prontos, mas sem recursos: estado VÁLIDO, resolvível em jogo. */}
                {request.allReady && !supplies.satisfied ? (
                  <div className="long-rest-blocked" role="status">
                    <p>
                      <strong>O grupo está pronto para descansar.</strong>
                    </p>
                    <p>
                      Recursos: {supplies.contributed} / {supplies.required} — faltam{' '}
                      {supplies.remaining} ponto(s).
                    </p>
                    <p className="section-note">
                      A situação ainda pode ser resolvida em jogo.
                    </p>

                    {suggestionsOpen ? <CampSupplySuggestions /> : null}

                    {confirm === 'override-narrative' ? (
                      <CampSupplyOverrideDialog
                        type="NARRATIVE"
                        supplies={supplies}
                        busy={pending === 'force-complete'}
                        onCancel={() => setConfirm(null)}
                        onConfirm={(input) => void rest.forceComplete(input)}
                      />
                    ) : confirm === 'override-administrative' ? (
                      <CampSupplyOverrideDialog
                        type="ADMINISTRATIVE"
                        supplies={supplies}
                        busy={pending === 'force-complete'}
                        onCancel={() => setConfirm(null)}
                        onConfirm={(input) => void rest.forceComplete(input)}
                      />
                    ) : (
                      <div className="modal-actions modal-actions-wrap">
                        <button
                          type="button"
                          className="btn btn-small"
                          disabled={busy}
                          onClick={() => {
                            setSuggestionsOpen(false);
                            setNotice('Aguardando novas contribuições ou uma decisão do Mestre.');
                          }}
                        >
                          Aguardar recursos
                        </button>
                        <button
                          type="button"
                          className="btn btn-small"
                          disabled={busy}
                          onClick={() => setSuggestionsOpen((value) => !value)}
                        >
                          Ideias para o Mestre
                        </button>
                        <button
                          type="button"
                          className="btn btn-small btn-primary"
                          disabled={busy}
                          onClick={() => {
                            setSuggestionsOpen(false);
                            setConfirm('override-narrative');
                          }}
                        >
                          Conceder exceção narrativa
                        </button>
                        <button
                          type="button"
                          className="btn btn-small btn-danger"
                          disabled={busy}
                          onClick={() => {
                            setSuggestionsOpen(false);
                            setConfirm('override-administrative');
                          }}
                        >
                          Forçar administrativamente
                        </button>
                      </div>
                    )}
                  </div>
                ) : null}
              </>
            ) : null}

            {confirm === 'force-complete' ? (
              <ConfirmStrip
                message={
                  supplies && supplies.enabled && !supplies.satisfied
                    ? 'Concluir mesmo sem os recursos necessários vai ser recusado pelo servidor — use uma das resoluções acima. Tentar assim mesmo?'
                    : 'Participantes que ainda não marcaram “Pronto” terão o descanso encerrado agora.'
                }
                confirmLabel="Finalizar agora"
                busy={pending === 'force-complete'}
                onBack={() => setConfirm(null)}
                onConfirm={() => void rest.forceComplete()}
              />
            ) : confirm === 'abort' ? (
              <ConfirmStrip
                message="Abortar este descanso? Nenhum benefício será aplicado, os recursos selecionados não serão consumidos e as reservas serão liberadas."
                confirmLabel="Abortar descanso"
                busy={pending === 'abort'}
                onBack={() => setConfirm(null)}
                onConfirm={() => void rest.abort()}
              />
            ) : confirm === null ? (
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => setConfirm('force-complete')}
                >
                  Forçar conclusão
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => setConfirm('abort')}
                >
                  Abortar Descanso Longo
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {request?.status === 'APPROVED' && !isMaster && character && me?.response === 'ACCEPTED' ? (
          <div className="short-rest-active">
            <p className="short-rest-lead">Preparativos para o descanso.</p>

            <div className="rest-summary-line">
              <span>Participantes</span>
              <strong>{acceptedCount}</strong>
              <span>· prontos</span>
              <strong>{acceptedCount - waitingCount}</strong>
            </div>

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
            {me.hitDiceRecovery ? (
              <LongRestHitDicePanel
                recovery={me.hitDiceRecovery}
                busy={pending === 'hit-dice'}
                onSetSelection={(selection) => void rest.setHitDice(selection)}
              />
            ) : (
              <p className="section-note">Sua sessão de descanso não está ativa.</p>
            )}
            <p className="section-note">
              Você decide a distribuição — 0 é uma escolha válida. Marcar-se pronto não trava esta
              seleção.
            </p>

            {supplies?.enabled ? (
              <>
                <h3 className="subsection-title">Recursos de Acampamento</h3>
                <CampSuppliesPanel
                  supplies={supplies}
                  character={character}
                  busyItemId={pending === 'supply' ? supplyItemId : null}
                  onChange={(inventoryItemId, quantity) =>
                    void saveSupply(inventoryItemId, quantity)
                  }
                />
              </>
            ) : null}

            {me.ready ? (
              <div className="short-rest-decision">
                <p>
                  <strong>✓ Você está pronto para descansar.</strong> O descanso conclui quando
                  todos estiverem prontos e os recursos permitirem.
                </p>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy}
                  onClick={() => void rest.setReady(false)}
                >
                  Alterar preparativos
                </button>
              </div>
            ) : (
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  title="Marcar como pronto significa que você terminou seus preparativos pessoais."
                  onClick={() => void rest.setReady(true)}
                >
                  {pending === 'ready' ? 'marcando…' : 'Pronto para descansar'}
                </button>
              </div>
            )}

            {/* Todos prontos, mas faltam recursos: estado normal, não é erro. */}
            {request.allReady && supplies && !supplies.satisfied ? (
              <div className="long-rest-blocked" role="status">
                <p>
                  <strong>
                    O grupo está pronto para descansar, mas ainda faltam recursos de acampamento.
                  </strong>
                </p>
                <p>
                  {supplies.contributed} / {supplies.required} — faltam {supplies.remaining}{' '}
                  ponto(s).
                </p>
                <p className="section-note">
                  Aguardando novas contribuições ou uma decisão do Mestre.
                </p>
              </div>
            ) : null}

            {request.allReady && supplies?.satisfied ? (
              <p className="section-note">
                Todos prontos e os recursos foram atendidos — o descanso conclui na marcação de
                pronto.
              </p>
            ) : null}

            <h3 className="subsection-title">Mesa</h3>
            <LongRestParticipants request={request} myCharacterId={character.id} />
          </div>
        ) : null}

        {/* Descanso em andamento, mas o jogador não participa. */}
        {request?.status === 'APPROVED' && !isMaster && (!me || me.response === 'DECLINED') ? (
          <div className="short-rest-pending">
            <p className="short-rest-decision">
              <strong>Você não está participando deste Descanso Longo.</strong>
            </p>
            <p className="section-note">Você pode acompanhar o andamento da mesa.</p>
            <h3 className="subsection-title">Mesa</h3>
            <LongRestParticipants request={request} myCharacterId={character?.id} />
          </div>
        ) : null}

        {/* ---- COMPLETED: resultado -------------------------------------- */}
        {request?.status === 'COMPLETED' ? (
          <LongRestResultView
            request={request}
            completion={completion}
            character={character}
            myCharacterId={character?.id}
            isMaster={isMaster}
            onClose={close}
          />
        ) : null}

        {/* ---- CANCELLED --------------------------------------------------- */}
        {request?.status === 'CANCELLED' ? (
          <div>
            <p className="short-rest-lead">Descanso Longo cancelado.</p>
            <p className="section-note">
              {request.cancelReason === 'NO_PARTICIPANTS'
                ? 'Ninguém aceitou o convite.'
                : request.cancelReason === 'ABORTED'
                  ? 'O Mestre abortou o descanso: nenhum benefício foi aplicado e as reservas foram liberadas.'
                  : 'A solicitação foi encerrada sem aplicar benefícios.'}
            </p>
            <h3 className="subsection-title">Status da mesa</h3>
            <LongRestParticipants request={request} myCharacterId={character?.id} />
            {declined.length === 0 ? null : (
              <p className="section-note">
                Não participaram deste descanso: {declined.map((p) => p.displayName).join(', ')}.
              </p>
            )}
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

/** Recursos que recarregam num Descanso Longo (regra do servidor, só exibição). */
function longRestResources(character: Character) {
  return character.classAdjustments.resources.filter((resource) => resource.recharge === 'long');
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
