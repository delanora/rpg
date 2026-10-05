import type { ReactNode } from 'react';
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
 * O QUE ESTÁ ACONTECENDO? Painel central de destaque do turno atual. Reúne o
 * mesmo estado que já era exibido no banner e na linha ativa, agora num só
 * lugar: retrato, nome, tipo, vida/CA e efeitos já conhecidos (não proficiência
 * de armadura, quando ativa).
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

  const hpCurrent = combatant.hpCurrent ?? 0;
  const hpMax = combatant.hpMax ?? 0;
  const percent = hpMax > 0 ? Math.max(0, Math.min(100, (hpCurrent / hpMax) * 100)) : 0;
  const nonProficientArmor = Boolean(
    combatant.armorNonProficiency?.armor || combatant.armorNonProficiency?.shield,
  );

  return (
    <section className={isMyTurn ? 'combat-turn-panel mine' : 'combat-turn-panel'}>
      <p className="combat-turn-eyebrow">
        <Icon name="sword" size={14} /> Rodada {round}
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
          <span className="hp-bar">
            <span className="hp-fill" style={{ width: `${percent}%` }} />
          </span>
          <span className="hp-text">
            {hpCurrent}/{hpMax}
          </span>
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
