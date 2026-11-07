import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { ConditionHistoryModal } from '../../components/ConditionHistoryModal';
import { formatModifier } from '../../dnd';
import type { ConditionEffects, MechanicalState, TurnEconomy } from '../../types';
import type { HotbarFilter } from '../hotbar';
import { CombatStateBadges } from './CombatStateBadges';
import { ConditionBadges } from './ConditionBadges';

interface PlayerCombatDockProps {
  name: string;
  /** Avatar do personagem (null = sem imagem). */
  imageUrl?: string | null;
  hpCurrent: number | null;
  hpMax: number | null;
  armorClass: number | null;
  mechanicalState: MechanicalState;
  conditionEffects: ConditionEffects;
  /** Economia persistida no SERVIDOR do combatente do turno. */
  economy?: TurnEconomy;
  concentration?: { label: string } | null;
  /** Ciclo de morte: a economia normal fica bloqueada (mas a dock permanece). */
  deathBlocked?: boolean;
  deathSavePending?: boolean;
  busy?: boolean;
  /**
   * AÇÃO GERAL já montada pelo tracker: o `ActionMenu` existente com Disparada,
   * Esquivar, Preparar, Levantar-se e Estabilizar. A dock NÃO reimplementa nada
   * disso — só reserva o lugar onde ele sempre esteve.
   */
  actionMenu: ReactNode;
  /** Slots da Hotbar existente (`CombatHotbar`) ou a espera compacta. */
  hotbar: ReactNode;
  /**
   * ESTADO DE ESPERA (6.6M.6.2): o personagem participa do combate, mas o turno
   * é de outro combatente. A dock continua visível (retrato, estado, utilitários
   * e decisões urgentes) e só a Hotbar vira apresentação de espera. Nada aqui
   * concede autoridade: a execução segue derivada do turno e validada pelo
   * servidor.
   */
  waiting?: boolean;
  /**
   * PRÉ-INICIATIVA (6.6M.7): o personagem está no combate e ainda NÃO rolou.
   *
   * A dock é a MESMA — o que muda é o miolo dela: os slots continuam visíveis
   * porém temporariamente indisponíveis (véu + desfoque) e o CTA de rolagem
   * flutua ancorado na área da Hotbar, nunca como card solto no corpo da tela.
   * Sem este objeto a dock é a de sempre. Nada aqui rola nada: `onRoll` só abre
   * o pedido que já existe e o servidor continua dono da iniciativa.
   */
  awaitingInitiative?: {
    /** Modificador de Destreza — exibição do `1d20 + mod` sugerido. */
    modifier: number;
    busy?: boolean;
    onRoll: () => void;
  } | null;
  /**
   * PERSONALIZAÇÃO DA HOTBAR (6.6M.6.3.1): gesto que ABRE o editor, ao lado do
   * retrato — um lápis pequeno, sem texto e sem linha nova. A dock só encaminha:
   * quem guarda o rascunho e salva é o orquestrador. Ausente = sem editor (é o
   * caso da visão do Mestre).
   */
  onPersonalizeHotbar?: () => void;
  /** Durante espera/pré-iniciativa/edição em curso o lápis fica indisponível. */
  personalizeDisabled?: boolean;
  /** Filtro ativo da Hotbar (navegação pelos três glifos). */
  hotbarFilter?: HotbarFilter | null;
  onToggleHotbarFilter?: (filter: HotbarFilter) => void;
  /** Atalhos da ficha + Encerrar turno (fluxo já existente). */
  utilities: ReactNode;
  /**
   * Deslocamento em METROS, já derivado pela MESMA economia do servidor
   * (orçamento e gasto do turno). A dock não recalcula orçamento, não recorta
   * saldo e não converte unidade: só desenha a proporção que recebeu.
   */
  movement: { remaining: number; budget: number };
  /** Controle de gasto (a mesma unidade da barra de recursos). */
  movementControl: ReactNode;
  /**
   * ESTADO DO PERSONAGEM (6.6M.6.1.4): o `MechanicalPanel` já montado pelo
   * tracker, na variante `dock`. Vem pronto — a dock não busca nem calcula
   * nada, e este é o ÚNICO painel de estado montado para a entidade.
   */
  statusPanel?: ReactNode;
  /**
   * AVISO OPERACIONAL acima da dock (salvaguarda pendente, 6.6M.6.1.4). Não é
   * uma segunda superfície mecânica: o tracker passa o MESMO formulário que já
   * existia, para ele ficar acessível com o retrato FECHADO.
   */
  urgent?: ReactNode;
}

/** Gema por recurso CONCEDIDO: gasto não vira booleano (Action Surge = 2). */
function Gems({ total, used, kind }: { total: number; used: number; kind: string }) {
  return (
    <span className="dock-pips" aria-hidden="true">
      {Array.from({ length: Math.max(1, total) }).map((_, index) => (
        <span
          key={index}
          className={`dock-pip is-${kind} ${index < used ? 'is-spent' : 'is-ready'}`}
        />
      ))}
    </span>
  );
}

/** Metro com vírgula decimal: é a leitura do protótipo ("7,5 / 9 m"). */
function meters(value: number): string {
  return String(value).replace('.', ',');
}

/**
 * DOCK DE COMBATE DO JOGADOR (6.6M.6.1 / geometria do HTML v4 — 6.6M.6.1.2).
 *
 * É composição e apresentação, nada além disso. A geometria tem quatro colunas
 * e duas linhas: retrato circular (atravessa as duas linhas) · coluna vertical
 * de recursos (Ação ◆, Ação Bônus ⬢, Reação ★) · Hotbar com a largura central ·
 * utilitários à direita, com o Encerrar turno em linha inteira. O deslocamento
 * começa à direita do retrato e atravessa o espaço sob recursos e Hotbar.
 *
 * Nenhum valor é recalculado — tudo vem da economia/server-authoritative do DTO
 * do combate, e os controles (menu de Ação, gasto de deslocamento, avanço de
 * turno) são os componentes de sempre, recebidos prontos. Por isso esta dock não
 * concede autoridade nenhuma.
 *
 * 6.6M.6.2: os três glifos viraram BOTÕES DE FILTRO da Hotbar (navegação por
 * custo, com `aria-pressed`) e a dock ganhou o estado de ESPERA — mesmo fora do
 * turno ela continua montada, com os recursos reais (Reação inclusive) e a
 * Hotbar reduzida à animação de espera, sem oferecer ação executável.
 *
 * 6.6M.7: a MESMA dock atende o estado PRÉ-INICIATIVA. Antes de rolar, ela fica
 * montada com o miolo bloqueado (slots visíveis, desfocados e inertes) e UM
 * botão centrado por cima da Hotbar — uma composição só, nem tela herdada nem
 * terceira variação visual.
 */
export function PlayerCombatDock({
  name,
  imageUrl = null,
  hpCurrent,
  hpMax,
  armorClass,
  mechanicalState,
  conditionEffects,
  economy,
  concentration = null,
  deathBlocked = false,
  deathSavePending = false,
  busy = false,
  actionMenu,
  hotbar,
  waiting = false,
  awaitingInitiative = null,
  onPersonalizeHotbar,
  personalizeDisabled = false,
  hotbarFilter = null,
  onToggleHotbarFilter,
  utilities,
  movement,
  movementControl,
  statusPanel,
  urgent,
}: PlayerCombatDockProps) {
  const [contextOpen, setContextOpen] = useState(false);
  /** Condição clicada no painel: abre a MESMA janela de histórico da ficha. */
  const [history, setHistory] = useState<string | null>(null);
  const portraitRef = useRef<HTMLDivElement>(null);
  const portraitButtonRef = useRef<HTMLButtonElement>(null);

  /** Fecha o painel; `refocus` devolve o foco ao retrato (Esc e botão ×). */
  const closeContext = (refocus: boolean): void => {
    setContextOpen(false);
    setHistory(null);
    if (refocus) portraitButtonRef.current?.focus();
  };

  // Fecha como os outros popovers do projeto: clique fora e Esc.
  useEffect(() => {
    if (!contextOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (portraitRef.current && !portraitRef.current.contains(event.target as Node)) {
        setContextOpen(false);
        setHistory(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      // Com a janela do histórico aberta, o Esc pertence a ELA (o modal tem o
      // próprio listener); o painel do retrato não fecha por baixo.
      if (event.key !== 'Escape' || history) return;
      setContextOpen(false);
      setHistory(null);
      portraitButtonRef.current?.focus();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [contextOpen, history]);

  const actionsLeft = economy ? economy.actionsGranted - economy.actionsUsed : 0;
  const hpPercent =
    hpCurrent !== null && hpMax !== null && hpMax > 0
      ? Math.max(0, Math.min(100, (hpCurrent / hpMax) * 100))
      : 0;
  // Proporção do deslocamento RESTANTE sobre o orçamento ATUAL (Disparada
  // amplia o orçamento; a barra acompanha, sem virar regra).
  const movementFill =
    movement.budget > 0
      ? Math.max(0, Math.min(100, (movement.remaining / movement.budget) * 100))
      : 0;
  // Indicador de CONTEXTO ATIVO no retrato: o painel deixa de ser descoberto
  // por acaso. Só estados que existem no servidor contam.
  const hasContext =
    mechanicalState.conditions.length > 0 ||
    Boolean(concentration) ||
    deathBlocked ||
    deathSavePending;
  // Texto COMPLETO de cada recurso: vai no BALÃO de hover/foco e é a descrição
  // acessível (`aria-describedby`). Nada de `title`: com ele o navegador abria
  // um segundo balão, com o mesmo texto, por cima do nosso. O glifo nunca é a
  // única fonte de informação.
  const actionsLabel = economy
    ? `Ação — ${actionsLeft} de ${economy.actionsGranted} ${
        economy.actionsGranted === 1 ? 'disponível' : 'disponíveis'
      }`
    : 'Ação — em espera';
  const bonusLabel = economy
    ? economy.bonusActionUsed
      ? 'Ação bônus — utilizada'
      : 'Ação bônus — disponível* (uso não consumido não concede uma Ação Bônus por si, PHB 2014)'
    : 'Ação bônus — em espera';
  const reactionLabel = economy
    ? economy.reactionAvailable
      ? 'Reação — disponível'
      : 'Reação — utilizada'
    : 'Reação — em espera';
  // Na ESPERA o glifo de Ação/Ação Bônus NÃO afirma saldo — nada de "0 de 1"
  // inventado fora do turno. A Reação continua com o valor REAL, porque ela é
  // relevante também fora do próprio turno.
  const actionTip = waiting ? 'Ação — aguardando o seu turno' : actionsLabel;
  const bonusTip = waiting ? 'Ação bônus — aguardando o seu turno' : bonusLabel;
  const filterOn = (kind: HotbarFilter): boolean => hotbarFilter === kind;

  return (
    <section
      className={
        awaitingInitiative ? 'combat-dock is-awaiting-initiative' : 'combat-dock'
      }
      aria-label="Dock de combate do jogador"
      aria-busy={busy || undefined}
    >
      {/* LÁPIS DO EDITOR DA HOTBAR: canto SUPERIOR ESQUERDO da dock — na
          diagonal acima do retrato —, maior e com alvo de clique confortável.
          Não é ação de combate: organizar a Hotbar não consome
          Ação/Bônus/Reação. Some/desabilita quando a dock está bloqueada. */}
      {onPersonalizeHotbar ? (
        <button
          type="button"
          className="dock-personalize"
          aria-label="Personalizar a Hotbar"
          title="Personalizar a Hotbar"
          disabled={personalizeDisabled}
          onClick={onPersonalizeHotbar}
        >
          <Icon name="quill" size={15} />
        </button>
      ) : null}

      {/* AVISO OPERACIONAL fora do retrato (6.6M.6.1.4): decisão urgente não
          fica atrás de um clique. Flutua ACIMA da dock, fora do grid (a
          geometria aprovada não muda) e some sozinho quando não há pendência. */}
      <div className="combat-dock-urgent">{urgent}</div>
      {/* RETRATO — circular, na moldura de latão, atravessando as DUAS linhas
          da dock. O clique abre o MESMO contexto de estado de sempre. */}
      <div className="dock-portrait-cell" ref={portraitRef}>
        <button
          ref={portraitButtonRef}
          type="button"
          className={hasContext ? 'dock-portrait has-context' : 'dock-portrait'}
          aria-expanded={contextOpen}
          aria-haspopup="dialog"
          aria-label={`Estado de ${name}`}
          onClick={() => setContextOpen((open) => !open)}
        >
          {imageUrl ? (
            <img src={imageUrl} alt="" />
          ) : (
            <span className="dock-portrait-fallback" aria-hidden="true">
              <Icon name="users" size={22} />
            </span>
          )}
          <span className="dock-portrait-hp" aria-hidden="true">
            <span style={{ width: `${hpPercent}%` }} />
          </span>
        </button>

        {/* Legenda do nome: no protótipo é uma legenda abaixo do círculo. */}
        <span className="dock-portrait-name" aria-hidden="true">
          {name}
        </span>

        {/* PAINEL DE ESTADO DO PERSONAGEM (6.6M.6.1.4) — diálogo NÃO modal: o
            resto da interface continua interativo, então nada aqui se declara
            `aria-modal`. Só apresentação: todo número vem do DTO do servidor. */}
        {contextOpen ? (
          <div
            className="dock-context"
            role="dialog"
            aria-modal={false}
            aria-labelledby="dock-context-name"
          >
            <div className="dock-context-header">
              <span className="dock-context-eyebrow">Estado do personagem</span>
              <span className="dock-context-head" id="dock-context-name">
                {name}
              </span>
              <button
                type="button"
                className="dock-context-close"
                aria-label="Fechar estado do personagem"
                onClick={() => closeContext(true)}
              >
                <Icon name="x" size={14} />
              </button>
            </div>

            <div className="dock-context-content">
              <dl className="dock-context-stats" aria-label="Resumo do personagem">
                <div>
                  <dt>Pontos de vida</dt>
                  <dd>
                    {hpCurrent ?? '—'}
                    <span className="dock-context-stat-minor"> / {hpMax ?? '—'}</span>
                  </dd>
                </div>
                <div>
                  <dt>Defesa</dt>
                  <dd>{armorClass ?? '—'}</dd>
                </div>
                <div>
                  <dt>Deslocamento</dt>
                  <dd className="dock-context-stat-minor">
                    {meters(movement.remaining)} / {meters(movement.budget)} m
                  </dd>
                </div>
              </dl>

              {/* Estados (Esquiva/Preparada/Concentração) e condições vêm do
                  MESMO estado derivado da ficha/combate — nada é inventado. */}
              <section className="dock-context-section" aria-label="Condições e estados">
                <h4 className="dock-context-section-title">Condições e estados</h4>
                <CombatStateBadges turnEconomy={economy} concentration={concentration} />
                <ConditionBadges
                  state={mechanicalState}
                  effects={conditionEffects}
                  onOpenHistory={setHistory}
                />
                {mechanicalState.conditions.length === 0 ? (
                  <p className="dock-context-note">Nenhuma condição ativa.</p>
                ) : null}
              </section>

              {/* Efeitos + concentração: o MESMO `MechanicalPanel` do combate,
                  na variante `dock` (uma instância, fora daqui só a pendência). */}
              <section className="dock-context-section" aria-label="Efeitos e concentração">
                <h4 className="dock-context-section-title">Efeitos e concentração</h4>
                {statusPanel ?? <p className="dock-context-note">Nenhum efeito ativo.</p>}
              </section>

              {deathBlocked ? (
                <p className="dock-context-note">
                  <Icon name="skull" size={12} /> Ciclo de morte — a economia de turno
                  está bloqueada pelo servidor.
                </p>
              ) : null}
              {deathSavePending ? (
                <p className="dock-context-note">
                  Role o Teste Contra a Morte antes de encerrar o turno.
                </p>
              ) : null}

              {/* HISTÓRICO recolhido: o registro do servidor, mais recente
                  primeiro. As etiquetas acima abrem a janela completa. */}
              <details className="dock-context-details">
                <summary className="dock-context-section-title">Histórico e ajustes</summary>
                {mechanicalState.log.length === 0 ? (
                  <p className="dock-context-note">Nada registrado até aqui.</p>
                ) : (
                  <ol className="dock-context-log">
                    {mechanicalState.log
                      .slice(-6)
                      .reverse()
                      .map((entry) => (
                        <li key={entry.id}>{entry.message}</li>
                      ))}
                  </ol>
                )}
                <p className="dock-context-note">
                  Ajustes de condições, Exaustão e efeitos são do Mestre. Levantar-se e
                  encerrar a concentração continuam nos controles que já existem.
                </p>
              </details>
            </div>
          </div>
        ) : null}

        {history ? (
          <ConditionHistoryModal
            condition={conditionEffects.labels[history] ?? history}
            entries={[...mechanicalState.log].reverse()}
            onClose={() => setHistory(null)}
          />
        ) : null}
      </div>

      {/* RECURSOS — coluna vertical de símbolos, na ordem do PHB 2014:
          Ação (losango) · Ação Bônus (hexágono) · Reação (estrela). SEM texto
          permanente na coluna: o estado completo fica no balão de hover/foco,
          que também é a descrição acessível da célula, e o glifo carrega a
          leitura visual. */}
      <div className="dock-resources" aria-label="Recursos do turno">
        {deathBlocked ? (
          <p className="dock-death" title="Sem economia de turno — Testes contra a Morte">
            <Icon name="skull" size={13} />
            <span className="dock-death-label">Sem turno</span>
          </p>
        ) : (
          <>
            {/* AÇÃO — o glifo é o BOTÃO DO FILTRO (6.6M.6.2): mostra só as
                entradas de custo Ação; clicar de novo volta à lista completa.
                O menu de Ação continua um gatilho IRMÃO (nunca aninhado), então
                abrir o menu não troca o filtro por acidente. */}
            <div
              className={`dock-resource is-action${filterOn('action') ? ' is-filtering' : ''}`}
            >
              <button
                type="button"
                className="dock-resource-trigger"
                aria-pressed={filterOn('action')}
                aria-label="Filtrar a Hotbar por Ação"
                aria-describedby="dock-action-tip"
                disabled={waiting}
                onClick={() => onToggleHotbarFilter?.('action')}
              >
                {waiting ? (
                  <span className="dock-pip is-action is-idle" aria-hidden="true" />
                ) : (
                  <Gems
                    total={economy?.actionsGranted ?? 0}
                    used={economy?.actionsUsed ?? 0}
                    kind="action"
                  />
                )}
              </button>
              <span className="dock-resource-label">Ação</span>
              <span
                className="dock-resource-tip"
                id="dock-action-tip"
                role="tooltip"
              >
                {actionTip}
              </span>
              {/* O MESMO menu de Ação (Disparada, Esquivar, Preparar, Levantar,
                  Estabilizar): acesso compacto junto ao losango. */}
              {actionMenu}
            </div>

            {/* O `*` continua no título: gema cheia = uso NÃO consumido, não
                uma Ação Bônus automaticamente executável (PHB 2014). */}
            <div
              className={`dock-resource is-bonus-cell${
                filterOn('bonus-action') ? ' is-filtering' : ''
              }`}
            >
              <button
                type="button"
                className="dock-resource-trigger"
                aria-pressed={filterOn('bonus-action')}
                aria-label="Filtrar a Hotbar por Ação bônus"
                aria-describedby="dock-bonus-tip"
                disabled={waiting}
                onClick={() => onToggleHotbarFilter?.('bonus-action')}
              >
                <span
                  className={`dock-pip is-bonus ${
                    waiting
                      ? 'is-idle'
                      : economy && economy.bonusActionUsed
                        ? 'is-spent'
                        : 'is-ready'
                  }`}
                  aria-hidden="true"
                />
              </button>
              <span className="dock-resource-label">Ação bônus</span>
              <span
                className="dock-resource-tip"
                id="dock-bonus-tip"
                role="tooltip"
              >
                {bonusTip}
              </span>
            </div>

            <div
              className={`dock-resource is-reaction-cell${
                filterOn('reaction') ? ' is-filtering' : ''
              }`}
            >
              <button
                type="button"
                className="dock-resource-trigger"
                aria-pressed={filterOn('reaction')}
                aria-label="Filtrar a Hotbar por Reação"
                aria-describedby="dock-reaction-tip"
                disabled={waiting}
                onClick={() => onToggleHotbarFilter?.('reaction')}
              >
                <span
                  className={`dock-pip is-reaction ${
                    economy && !economy.reactionAvailable ? 'is-spent' : 'is-ready'
                  }`}
                  aria-hidden="true"
                />
              </button>
              <span className="dock-resource-label">Reação</span>
              <span
                className="dock-resource-tip"
                id="dock-reaction-tip"
                role="tooltip"
              >
                {reactionLabel}
              </span>
            </div>
          </>
        )}
      </div>

      {/* HOTBAR — o centro funcional e visual: poço próprio, slots de ~55px.
          PRÉ-INICIATIVA (6.6M.7): os slots continuam ali (o miolo recebe véu e
          desfoque, e fica `inert`) e o CTA de rolagem flutua DENTRO desta
          célula — ancorado na Hotbar, sem empurrar layout e sem cortar tooltip
          de slot (que só existe quando os slots estão interativos). */}
      <div
        className={
          awaitingInitiative ? 'dock-hotbar is-awaiting-initiative' : 'dock-hotbar'
        }
      >
        <div className="dock-hotbar-track" inert={Boolean(awaitingInitiative)}>
          {hotbar}
        </div>

        {awaitingInitiative ? (
          /* Sobre a Hotbar desfocada fica SÓ o botão, centrado nos dois eixos
             e com pulsação sutil: o véu já diz o que está indisponível, então
             nada mais compete com o CTA. A rolagem sugerida vive dentro dele. */
          <div
            className="dock-initiative-overlay"
            role="group"
            aria-label="Rolar iniciativa"
          >
            <button
              type="button"
              className="btn btn-primary dock-initiative-roll"
              disabled={awaitingInitiative.busy}
              title="Role a iniciativa para entrar na ordem de combate"
              onClick={awaitingInitiative.onRoll}
            >
              <Icon name="die" size={15} /> Rolar iniciativa
              <span className="dock-initiative-roll-mod">
                1d20 {formatModifier(awaitingInitiative.modifier)}
              </span>
            </button>
          </div>
        ) : null}
      </div>

      {/* UTILITÁRIOS — bloco delimitado à direita: 3×2 e Encerrar turno embaixo. */}
      <div className="dock-utilities">{utilities}</div>

      {/* DESLOCAMENTO — começa à direita do retrato e atravessa o espaço sob
          recursos e Hotbar, terminando antes dos utilitários. */}
      <div className="dock-movement-row">
        <span className="dock-movement-label">
          <Icon name="wind" size={12} />
          <span className="dock-movement-word">Deslocamento</span>
        </span>
        <span className="dock-movement-value">
          {meters(movement.remaining)} / {meters(movement.budget)} m
        </span>
        <div
          className="dock-movement-track"
          role="img"
          aria-label={`${meters(movement.remaining)} de ${meters(
            movement.budget,
          )} metros restantes`}
        >
          <span
            className="dock-movement-fill"
            style={{ width: `${movementFill}%` }}
          />
        </div>
        {movementControl}
      </div>
    </section>
  );
}
