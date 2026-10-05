import type { ReactNode } from 'react';
import { HpBar } from '../../components/HpBar';
import { Icon } from '../../components/Icon';
import { Portrait } from '../../components/Portrait';
import type { CombatantDto } from '../../types';

interface CombatantCardProps {
  combatant: CombatantDto;
  /** Posição na ordem de iniciativa (1-based). */
  rank?: number;
  /** Este é o combatente com o turno ativo. */
  current?: boolean;
  /** Este é o próximo a jogar depois do atual. */
  next?: boolean;
  /** Conteúdo à direita do cartão (iniciativa, botão "rolar" etc.). */
  trailing?: ReactNode;
}

/**
 * Cada combatente da iniciativa é uma pequena placa de pergaminho encaixada no
 * grimório. A hierarquia é sempre: posição → retrato → nome → tipo → HP → CA.
 *
 * Respeita o que o jogador já pode saber: quando a vida/CA estão ocultas
 * (`statsHidden`) aparece o aviso em vez dos números — mesma regra do backend.
 * O destaque do turno atual e o indicador do próximo usam só a paleta existente.
 */
export function CombatantCard({ combatant, rank, current, next, trailing }: CombatantCardProps) {
  const classes = ['combatant-card'];
  if (current) classes.push('current');
  else if (next) classes.push('next');

  return (
    <article className={classes.join(' ')}>
      {rank !== undefined ? (
        <span className="combatant-card-rank" aria-label={`Posição ${rank} na iniciativa`}>
          {String(rank).padStart(2, '0')}
        </span>
      ) : null}

      <div className="combatant-card-main">
        <div className="combatant-card-head">
          <Portrait
            src={combatant.imageUrl ?? ''}
            alt=""
            size="sm"
            icon={combatant.kind === 'CREATURE' ? 'flame' : 'users'}
          />

          <span className="combatant-card-id">
            <span className="combatant-card-name-row">
              <span className="combatant-card-name">
                {combatant.name}
                {combatant.missing ? <em className="tag">removido</em> : null}
              </span>
              {current ? (
                <span className="combatant-card-status agora">
                  <Icon name="sparkle" size={11} /> AGORA
                </span>
              ) : next ? (
                <span className="combatant-card-status proximo">PRÓXIMO</span>
              ) : null}
            </span>
            <span className="combatant-card-kind">
              {combatant.kind === 'CREATURE' ? 'criatura' : 'personagem'}
            </span>
          </span>

          {trailing ? <span className="combatant-card-tail">{trailing}</span> : null}
        </div>

        {/* Vida e CA de criaturas ficam ocultas para os jogadores. */}
        {combatant.statsHidden ? (
          <span className="combatant-card-hidden" title="Vida e CA visíveis apenas para o mestre">
            <Icon name="eye" size={13} /> vida e CA ocultas
          </span>
        ) : (
          <div className="combatant-card-stats">
            <HpBar
              current={combatant.hpCurrent ?? 0}
              max={combatant.hpMax ?? 0}
              label={combatant.name}
              className="combatant-card-hp"
            />
            <span className="combatant-card-ac">CA {combatant.armorClass}</span>
          </div>
        )}
      </div>
    </article>
  );
}
