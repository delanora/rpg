import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { ConditionHistoryModal } from '../../components/ConditionHistoryModal';
import type { ConditionEffects, MechanicalState, TurnEconomy } from '../../types';
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
  /** Slots da Hotbar existente (`CombatHotbar`). */
  hotbar: ReactNode;
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

  return (
    <section
      className="combat-dock"
      aria-label="Dock de combate do jogador"
      aria-busy={busy || undefined}
    >
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
            <div
              className="dock-resource is-action"
              tabIndex={0}
              aria-label="Ação"
              aria-describedby="dock-action-tip"
            >
              <span className="dock-resource-label">Ação</span>
              <Gems
                total={economy?.actionsGranted ?? 0}
                used={economy?.actionsUsed ?? 0}
                kind="action"
              />
              <span
                className="dock-resource-tip"
                id="dock-action-tip"
                role="tooltip"
              >
                {actionsLabel}
              </span>
              {/* O MESMO menu de Ação (Disparada, Esquivar, Preparar, Levantar,
                  Estabilizar): acesso compacto junto ao losango. */}
              {actionMenu}
            </div>

            {/* O `*` continua no título: gema cheia = uso NÃO consumido, não
                uma Ação Bônus automaticamente executável (PHB 2014). */}
            <div
              className="dock-resource"
              tabIndex={0}
              aria-label="Ação bônus"
              aria-describedby="dock-bonus-tip"
            >
              <span className="dock-resource-label">Ação bônus</span>
              <span
                className={`dock-pip is-bonus ${
                  economy && economy.bonusActionUsed ? 'is-spent' : 'is-ready'
                }`}
                aria-hidden="true"
              />
              <span
                className="dock-resource-tip"
                id="dock-bonus-tip"
                role="tooltip"
              >
                {bonusLabel}
              </span>
            </div>

            <div
              className="dock-resource"
              tabIndex={0}
              aria-label="Reação"
              aria-describedby="dock-reaction-tip"
            >
              <span className="dock-resource-label">Reação</span>
              <span
                className={`dock-pip is-reaction ${
                  economy && !economy.reactionAvailable ? 'is-spent' : 'is-ready'
                }`}
                aria-hidden="true"
              />
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

      {/* HOTBAR — o centro funcional e visual: poço próprio, slots de ~55px. */}
      <div className="dock-hotbar">{hotbar}</div>

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
