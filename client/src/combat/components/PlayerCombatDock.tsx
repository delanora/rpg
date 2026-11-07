import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
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

/**
 * DOCK DE COMBATE DO JOGADOR (6.6M.6.1).
 *
 * É composição e apresentação, nada além disso: retrato (contexto de estado),
 * indicadores de recurso, a Hotbar já existente, atalhos da ficha, Encerrar
 * turno e a barra de deslocamento. Nenhum valor é recalculado — tudo vem da
 * economia/server-authoritative do DTO do combate, e os controles (menu de
 * Ação, gasto de deslocamento, avanço de turno) são os componentes de sempre,
 * recebidos prontos. Por isso esta dock não concede autoridade nenhuma.
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
}: PlayerCombatDockProps) {
  const [contextOpen, setContextOpen] = useState(false);
  const portraitRef = useRef<HTMLDivElement>(null);

  // Fecha como os outros popovers do projeto: clique fora e Esc.
  useEffect(() => {
    if (!contextOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (portraitRef.current && !portraitRef.current.contains(event.target as Node)) {
        setContextOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [contextOpen]);

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

  return (
    <section
      className="combat-dock"
      aria-label="Dock de combate do jogador"
      aria-busy={busy || undefined}
    >
      <div className="combat-dock-main">
        {/* RETRATO — o clique abre o contexto do próprio personagem. */}
        <div className="dock-portrait-cell" ref={portraitRef}>
          <button
            type="button"
            className="dock-portrait"
            aria-expanded={contextOpen}
            aria-haspopup="dialog"
            aria-label={`Estado de ${name}`}
            onClick={() => setContextOpen((open) => !open)}
          >
            {imageUrl ? (
              <img src={imageUrl} alt="" />
            ) : (
              <span className="dock-portrait-fallback" aria-hidden="true">
                <Icon name="users" size={20} />
              </span>
            )}
            <span className="dock-portrait-hp" aria-hidden="true">
              <span style={{ width: `${hpPercent}%` }} />
            </span>
          </button>

          {contextOpen ? (
            <div className="dock-context" role="dialog" aria-label={`Estado de ${name}`}>
              <p className="dock-context-head">{name}</p>

              <dl className="dock-context-stats">
                <div>
                  <dt>PV</dt>
                  <dd>
                    {hpCurrent ?? '—'} / {hpMax ?? '—'}
                  </dd>
                </div>
                <div>
                  <dt>CA</dt>
                  <dd>{armorClass ?? '—'}</dd>
                </div>
              </dl>

              {/* Estados (Esquiva/Preparada/Concentração) e condições vêm do
                  MESMO estado derivado da ficha/combate — nada é inventado. */}
              <CombatStateBadges turnEconomy={economy} concentration={concentration} />
              <ConditionBadges state={mechanicalState} effects={conditionEffects} />

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
            </div>
          ) : null}
        </div>

        {/* RECURSOS — leitura da economia do turno. */}
        <div className="dock-resources" aria-label="Recursos do turno">
          {deathBlocked ? (
            <p className="dock-death">
              <Icon name="skull" size={13} /> Sem economia de turno — Testes contra a
              Morte
            </p>
          ) : (
            <>
              <div className="dock-resource">
                <span className="dock-resource-label">Ação</span>
                <span className="dock-resource-row">
                  {actionMenu}
                  <Gems
                    total={economy?.actionsGranted ?? 0}
                    used={economy?.actionsUsed ?? 0}
                    kind="action"
                  />
                  <span className="dock-resource-count">
                    {economy ? `${actionsLeft}/${economy.actionsGranted}` : 'em espera'}
                  </span>
                </span>
              </div>

              {/* O `*` continua: gema cheia = uso NÃO consumido, não uma Ação
                  Bônus automaticamente executável (PHB 2014). */}
              <div className="dock-resource">
                <span className="dock-resource-label">Ação bônus</span>
                <span className="dock-resource-row">
                  <span
                    className={`dock-pip is-bonus ${
                      economy && economy.bonusActionUsed ? 'is-spent' : 'is-ready'
                    }`}
                    aria-hidden="true"
                  />
                  <span className="dock-resource-count">
                    {economy
                      ? economy.bonusActionUsed
                        ? 'utilizada'
                        : 'disponível*'
                      : 'em espera'}
                  </span>
                </span>
              </div>

              <div className="dock-resource">
                <span className="dock-resource-label">Reação</span>
                <span className="dock-resource-row">
                  <span
                    className={`dock-pip is-reaction ${
                      economy && !economy.reactionAvailable ? 'is-spent' : 'is-ready'
                    }`}
                    aria-hidden="true"
                  />
                  <span className="dock-resource-count">
                    {economy
                      ? economy.reactionAvailable
                        ? 'disponível'
                        : 'utilizada'
                      : 'em espera'}
                  </span>
                </span>
              </div>
            </>
          )}
        </div>

        {/* HOTBAR — os slots de sempre. */}
        <div className="dock-hotbar">{hotbar}</div>

        {/* UTILITÁRIOS — atalhos da ficha e Encerrar turno. */}
        <div className="dock-utilities">{utilities}</div>
      </div>

      {/* DESLOCAMENTO — do retrato até antes dos utilitários. */}
      <div className="dock-movement-row">
        <span className="dock-movement-label">
          <Icon name="wind" size={12} /> Deslocamento
        </span>
        <div
          className="dock-movement-track"
          role="img"
          aria-label={`${movement.remaining} de ${movement.budget} metros restantes`}
        >
          <span
            className="dock-movement-fill"
            style={{ width: `${movementFill}%` }}
          />
        </div>
        <span className="dock-movement-value">
          {movement.remaining} / {movement.budget} m
        </span>
        {movementControl}
      </div>
    </section>
  );
}
