import type { ReactNode } from 'react';
import { HpBar } from '../../components/HpBar';
import { Icon } from '../../components/Icon';
import { Portrait } from '../../components/Portrait';
import type { CombatantDto } from '../../types';

interface CombatTurnPanelProps {
  combatant: CombatantDto | null;
  round: number;
  /** O combatente do turno atual pertence ao jogador. */
  isMyTurn: boolean;
  /** Conteúdo alternativo quando ninguém está com o turno (ex.: iniciativa). */
  empty?: ReactNode;
}

/**
 * O QUE ESTÁ ACONTECENDO? A "página aberta no combatente atual" do grimório:
 * moldura dourada, ornamento, brilho discreto e o marcador AGORA. Reúne retrato,
 * nome, tipo, vida/CA e efeitos já existentes (não proficiência de armadura).
 */
export function CombatTurnPanel({ combatant, round, isMyTurn, empty }: CombatTurnPanelProps) {
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
          size="lg"
          icon={combatant.kind === 'CREATURE' ? 'flame' : 'users'}
        />

        <div className="combat-turn-id">
          <span className="combat-turn-name">{combatant.name}</span>
          <span className="combat-turn-kind">
            {combatant.kind === 'CREATURE' ? 'criatura' : 'personagem'}
          </span>
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
