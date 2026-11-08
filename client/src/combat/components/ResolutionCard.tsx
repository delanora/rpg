import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Icon } from '../../components/Icon';
import type {
  AbilityKey,
  CombatResolutionCardDto,
  EffectOptionalModifierDto,
} from '../../types';
import { DeathCounter } from '../../death/DeathCounter';

/**
 * 6.6I — CARD DE RESOLUÇÃO no registro lateral.
 *
 * Só APRESENTAÇÃO: título, descrição curta, atributo e contadores chegam
 * prontos do servidor. O card nunca calcula bônus, CD ou resultado; ele devolve
 * apenas a INTENÇÃO (rolar/recusar) e, quando o servidor oferece modificadores
 * opcionais, os IDs marcados.
 *
 * Os dois tipos desta fase compartilham a mesma casca:
 *  • `spell-saving-throw` — inicial ou "fim do turno" (com recusa opcional);
 *  • `death-saving-throw` — obrigatório, com o contador Sucessos/Falhas.
 */

const ABILITY_LABELS: Record<AbilityKey, string> = {
  strength: 'Força',
  dexterity: 'Destreza',
  constitution: 'Constituição',
  intelligence: 'Inteligência',
  wisdom: 'Sabedoria',
  charisma: 'Carisma',
};

interface ResolutionCardProps {
  card: CombatResolutionCardDto;
  busy: boolean;
  /** Personagem assumido mantém a audiência pública do jogador. */
  publicOnly?: boolean;
  /** Rola a salvaguarda da magia (o servidor calcula tudo). */
  onRollSpell: (
    card: CombatResolutionCardDto,
    selected: string[],
    visibility: 'public' | 'private' | null,
  ) => void;
  /** Recusa uma salvaguarda opcional de fim de turno. */
  onDecline: (card: CombatResolutionCardDto) => void;
  /** Rola o Teste contra a Morte pelo fluxo autoritativo existente. */
  onRollDeath: (card: CombatResolutionCardDto) => void;
}

export function ResolutionCard({
  card,
  busy,
  onRollSpell,
  onDecline,
  onRollDeath,
  publicOnly = false,
}: ResolutionCardProps) {
  const [options, setOptions] = useState<EffectOptionalModifierDto[]>([]);
  const [selected, setSelected] = useState<string[]>([]);

  const isSpell = card.kind === 'spell-saving-throw';
  const entity = card.reference.entity;
  const ability = card.ability;

  // Modificadores OPCIONAIS vêm do servidor (rótulos já sanitizados). A leitura
  // é complementar: sem ela o card continua rolável.
  useEffect(() => {
    let live = true;
    setSelected([]);
    if (!isSpell || !entity || !ability) {
      setOptions([]);
      return () => {
        live = false;
      };
    }
    const query = new URLSearchParams({ roll: 'save', ability });
    api<{ options: EffectOptionalModifierDto[] }>(
      `/api/dice/options/${entity.kind}/${entity.id}?${query.toString()}`,
    )
      .then((result) => {
        if (live) setOptions(result.options);
      })
      .catch(() => {
        if (live) setOptions([]);
      });
    return () => {
      live = false;
    };
  }, [isSpell, entity?.kind, entity?.id, ability, card.id]);

  const rollActions = card.actions.filter((action) => action.kind === 'roll' && (!publicOnly || action.visibility !== 'private'));
  const canDecline = card.actions.some((action) => action.kind === 'decline');
  const ongoing = card.phase === 'ongoing';

  return (
    <article
      className={`resolution-card ${card.presentation.tone}${ongoing ? ' ongoing' : ''}`}
      data-resolution-card={card.id}
      data-resolution-kind={card.kind}
      aria-label={card.title}
    >
      <header className="resolution-card-head">
        <span className={`resolution-card-icon ${card.presentation.tone}`}>
          <Icon name={card.presentation.icon} size={15} />
        </span>
        <span className="resolution-card-title">{card.title}</span>
        <span className="resolution-card-target">{card.target.name}</span>
      </header>

      {card.shortDescription ? (
        <p className="resolution-card-description">{card.shortDescription}</p>
      ) : null}

      <p className="resolution-card-meta">
        {isSpell && ability ? `Salvaguarda de ${ABILITY_LABELS[ability]}` : 'Salvaguarda contra a Morte'}
        {ongoing ? ' — fim do turno' : ''}
      </p>

      {card.counters ? (
        <div className="resolution-card-counters">
          <DeathCounter
            successes={card.counters.successes}
            failures={card.counters.failures}
            showNumbers
          />
        </div>
      ) : null}

      {options.length > 0 ? (
        <div className="resolution-card-options">
          {options.map((option) => (
            <label key={option.id} className="field-hint">
              <input
                type="checkbox"
                checked={selected.includes(option.id)}
                disabled={busy}
                onChange={(event) =>
                  setSelected((list) =>
                    event.target.checked
                      ? [...list, option.id]
                      : list.filter((id) => id !== option.id),
                  )
                }
              />{' '}
              {option.label}
              {option.kind === 'roll-dice' ? ` +${option.count ?? 1}d${option.sides ?? 4}` : ''}
            </label>
          ))}
        </div>
      ) : null}

      <div className="resolution-card-actions">
        {isSpell
          ? rollActions.map((action) => (
              <button
                key={`${action.kind}-${action.actor}-${action.visibility ?? 'owner'}`}
                type="button"
                className="btn btn-small resolution-card-roll"
                disabled={busy || !card.canResolve}
                onClick={() => onRollSpell(card, selected, action.visibility)}
              >
                <Icon name="die" size={13} />
                {action.visibility === 'private'
                  ? 'Rolar privado'
                  : action.visibility === 'public'
                    ? 'Rolar público'
                    : 'Rolar salvaguarda'}
              </button>
            ))
          : rollActions.map((action) => (
              <button
                key={`${action.kind}-${action.actor}`}
                type="button"
                className="btn btn-small resolution-card-roll"
                disabled={busy || !card.canResolve}
                onClick={() => onRollDeath(card)}
              >
                <Icon name="die" size={13} /> Rolar salvaguarda
              </button>
            ))}

        {canDecline ? (
          <button
            type="button"
            className="btn btn-small"
            disabled={busy}
            title="O efeito continua ativo; o próximo turno oferece outra chance."
            onClick={() => onDecline(card)}
          >
            Não tentar neste turno
          </button>
        ) : null}
      </div>

      {busy ? <p className="resolution-card-status">Resolvendo…</p> : null}
    </article>
  );
}
