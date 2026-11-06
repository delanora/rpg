import type { ReactNode } from 'react';
import { HpBar } from '../../components/HpBar';
import { Icon } from '../../components/Icon';
import { Portrait } from '../../components/Portrait';
import type { CombatantDto } from '../../types';
import { combatantKindIcon, combatantKindLabel } from '../combatVisuals';

interface CombatTurnPanelProps {
  combatant: CombatantDto | null;
  round: number;
  /** O combatente do turno atual pertence ao jogador. */
  isMyTurn: boolean;
  /** Conteúdo alternativo quando ninguém está com o turno (ex.: iniciativa). */
  empty?: ReactNode;
  /**
   * `full` = a página do grimório; `compact` = a MESMA informação em uma linha,
   * para o cabeçalho do workspace (rodada · quem joga · HP · CA · SEU TURNO).
   */
  variant?: 'full' | 'compact';
}

/**
 * O QUE ESTÁ ACONTECENDO? A "página aberta no combatente atual" do grimório:
 * moldura dourada, ornamento, brilho discreto e o marcador AGORA. Reúne retrato,
 * nome, tipo, vida/CA e efeitos já existentes (não proficiência de armadura).
 */
export function CombatTurnPanel({
  combatant,
  round,
  isMyTurn,
  empty,
  variant = 'full',
}: CombatTurnPanelProps) {
  // Variante COMPACTA: não perde contexto (quem joga, vida, CA, SEU TURNO) e
  // não vira um segundo sistema — é o mesmo componente, só sem a moldura alta.
  if (variant === 'compact') {
    return (
      <section
        className={['combat-turn-panel', 'compact', isMyTurn ? 'mine' : ''].filter(Boolean).join(' ')}
        aria-label={combatant ? `Turno atual: ${combatant.name}` : 'Turno atual'}
      >
        {combatant ? (
          <>
            <Portrait
              src={combatant.imageUrl ?? ''}
              alt=""
              size="sm"
              icon={combatantKindIcon(combatant.kind)}
            />

            <span className="combat-turn-id">
              <span className="combat-turn-name">{combatant.name}</span>
              <span className="combat-turn-kind">{combatantKindLabel(combatant.kind)}</span>
              {combatant.missing ? <em className="tag">removido</em> : null}
            </span>

            {combatant.statsHidden ? (
              <span className="combat-turn-hidden">
                <Icon name="eye" size={13} /> vida e CA ocultas
              </span>
            ) : (
              <span className="combat-turn-compact-stats">
                <span>
                  HP {combatant.hpCurrent ?? 0}/{combatant.hpMax ?? 0}
                </span>
                <span>CA {combatant.armorClass}</span>
              </span>
            )}

            {isMyTurn ? (
              <span className="combat-turn-badge">
                <Icon name="sparkle" size={12} /> SEU TURNO
              </span>
            ) : null}

            {combatant.armorNonProficiency?.armor || combatant.armorNonProficiency?.shield ? (
              <span className="turn-effect">
                <Icon name="shield" size={12} /> sem proficiência com armadura
              </span>
            ) : null}
          </>
        ) : (
          <>
            <span className="combat-turn-eyebrow">
              <Icon name="sword" size={13} /> Turno atual
            </span>
            {empty ?? <span className="empty-hint">Aguardando o início dos turnos.</span>}
          </>
        )}
      </section>
    );
  }

  if (!combatant) {
    return (
      <section className="combat-turn-panel empty">
        <p className="combat-turn-eyebrow">
          <Icon name="sword" size={14} /> Turno atual
        </p>
        {empty ?? <p className="empty-hint">Aguardando o início dos turnos.</p>}
      </section>
    );
  }

  const nonProficientArmor = Boolean(
    combatant.armorNonProficiency?.armor || combatant.armorNonProficiency?.shield,
  );

  return (
    <section className={isMyTurn ? 'combat-turn-panel mine' : 'combat-turn-panel'}>
      <p className="combat-turn-eyebrow">
        <Icon name="sword" size={14} /> Rodada {round}
        <span className="combat-turn-now">
          <Icon name="sparkle" size={12} /> AGORA
        </span>
      </p>

      <div className="combat-turn-body">
        <Portrait
          src={combatant.imageUrl ?? ''}
          alt=""
          size="md"
          icon={combatantKindIcon(combatant.kind)}
        />

        <div className="combat-turn-id">
          <span className="combat-turn-name">{combatant.name}</span>
          <span className="combat-turn-kind">{combatantKindLabel(combatant.kind)}</span>
          {combatant.missing ? <em className="tag">removido</em> : null}
        </div>

        {isMyTurn ? (
          <span className="combat-turn-badge">
            <Icon name="sparkle" size={14} /> SEU TURNO
          </span>
        ) : null}
      </div>

      {combatant.statsHidden ? (
        <p className="combat-turn-hidden">
          <Icon name="eye" size={14} /> Vida e CA visíveis apenas para o mestre.
        </p>
      ) : (
        <div className="combat-turn-stats">
          <HpBar
            current={combatant.hpCurrent ?? 0}
            max={combatant.hpMax ?? 0}
            label={combatant.name}
            className="combat-turn-hp"
          />
          <span className="combat-turn-ac">CA {combatant.armorClass}</span>
        </div>
      )}

      {/* Efeitos já existentes no estado do combate (sem inventar regras). */}
      {nonProficientArmor ? (
        <div className="combat-turn-effects">
          <span className="turn-effect">
            <Icon name="shield" size={13} /> sem proficiência com armadura
          </span>
        </div>
      ) : null}
    </section>
  );
}
