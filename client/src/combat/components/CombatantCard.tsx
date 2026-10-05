import type { ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { Portrait } from '../../components/Portrait';
import type { CombatantDto } from '../../types';

interface CombatantCardProps {
  combatant: CombatantDto;
  /** Posição na ordem de iniciativa (1-based). */
  rank?: number;
  /** Este é o combatente com o turno ativo. */
  current?: boolean;
  /** Conteúdo à direita do cartão (iniciativa, botão "rolar" etc.). */
  trailing?: ReactNode;
}

/**
 * Cada combatente da iniciativa vira um cartão visual. Mostra apenas o que o
 * jogador já pode saber: quando a vida/CA estão ocultas (`statsHidden`) surge o
 * aviso em vez dos números — a mesma regra que já valia na lista anterior.
 */
export function CombatantCard({ combatant, rank, current, trailing }: CombatantCardProps) {
  const hpCurrent = combatant.hpCurrent ?? 0;
  const hpMax = combatant.hpMax ?? 0;
  const percent = hpMax > 0 ? Math.max(0, Math.min(100, (hpCurrent / hpMax) * 100)) : 0;

  return (
    <article className={current ? 'combatant-card current' : 'combatant-card'}>
      {rank !== undefined ? <span className="combatant-card-rank">{rank}</span> : null}

      <Portrait
        src={combatant.imageUrl ?? ''}
        alt=""
        size="sm"
        icon={combatant.kind === 'CREATURE' ? 'flame' : 'users'}
      />

      <div className="combatant-card-body">
        <span className="combatant-card-name">
          {combatant.name}
          {combatant.missing ? <em className="tag">removido</em> : null}
        </span>
        <span className="combatant-card-kind">
          {combatant.kind === 'CREATURE' ? 'criatura' : 'personagem'}
        </span>

        {/* Vida e CA de criaturas ficam ocultas para os jogadores. */}
        {combatant.statsHidden ? (
          <span className="combatant-card-hidden" title="Vida e CA visíveis apenas para o mestre">
            <Icon name="eye" size={13} /> vida e CA ocultas
          </span>
        ) : (
          <span className="combatant-card-stats">
            <span className="hp-bar">
              <span className="hp-fill" style={{ width: `${percent}%` }} />
            </span>
            <span className="hp-text">
              {hpCurrent}/{hpMax}
            </span>
            <span className="combatant-card-ac">CA {combatant.armorClass}</span>
          </span>
        )}
      </div>

      {trailing ? <div className="combatant-card-tail">{trailing}</div> : null}
    </article>
  );
}
