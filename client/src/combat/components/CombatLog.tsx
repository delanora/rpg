import { Icon, type IconName } from '../../components/Icon';
import { formatModifier } from '../../dnd';
import type { DamageBreakdownPayload, DamageComponentPayload } from '../../types';
import type { CombatLogEntry } from '../useCombatState';

/**
 * Monta a quebra do dano em uma linha legível, parte a parte:
 * `1d8(4)+1d6(2)+DES(+3)=9`. Os dados mostram os resultados rolados; os bônus
 * fixos (atributo, Fúria, munição) mostram o próprio valor.
 */
function formatBreakdown(breakdown: DamageBreakdownPayload): string {
  const parts = breakdown.parts.map((part) =>
    part.rolls.length > 0
      ? `${part.label}(${part.rolls.join('+')})`
      : `${part.label}(${formatModifier(part.value)})`,
  );
  return `${parts.join('+')}=${breakdown.total}`;
}

interface CombatLogProps {
  log: CombatLogEntry[];
}

const KIND_ICON: Record<CombatLogEntry['kind'], IconName> = {
  initiative: 'bolt',
  attack: 'die',
  damage: 'flame',
  result: 'sword',
  turn: 'sun',
  heal: 'heart',
  hp: 'heart',
  condition: 'eye',
  rage: 'flame',
  feature: 'book',
  spell: 'star',
};

interface EntryView {
  icon: IconName;
  variant: string;
  title: string;
  primary: string;
  secondary?: string;
}

/** Linha curta que o backend já permite montar (sem inventar dado nenhum). */
function describeEntry(entry: CombatLogEntry): EntryView {
  if (entry.kind === 'result') {
    const outcome = entry.critical
      ? { key: 'crit', label: 'CRÍTICO!' }
      : entry.naturalOne
        ? { key: 'fail', label: 'FALHA CRÍTICA' }
        : entry.hit
          ? { key: 'hit', label: 'ACERTO' }
          : { key: 'miss', label: 'ERROU' };
    const ca = entry.targetArmorClass === null ? 'CA ?' : `CA ${entry.targetArmorClass}`;
    return {
      icon: 'sword',
      variant: `result ${outcome.key}`,
      title: entry.attackName ?? 'Ataque',
      primary: `${entry.attackTotal} vs ${ca} · ${outcome.label}`,
      ...(entry.hit && entry.damageRolled != null
        ? {
            secondary: entry.components?.[0]?.breakdown
              ? `${formatBreakdown(entry.components[0].breakdown)} ${
                  entry.damageType ?? ''
                }`.trim()
              : `${entry.damageRolled} ${entry.damageType ?? ''}`.trim(),
          }
        : {}),
    };
  }

  if (entry.kind === 'turn') {
    return {
      icon: KIND_ICON.turn,
      variant: 'turn',
      title: 'Início de turno',
      primary: `Rodada ${entry.round ?? '—'}`,
    };
  }

  const title =
    entry.kind === 'initiative' ? 'Iniciativa' : entry.kind === 'attack' ? 'Ataque' : 'Dano';
  const modifierLabel =
    entry.modifier && entry.modifier !== 0
      ? ` ${entry.modifier > 0 ? `+${entry.modifier}` : entry.modifier}`
      : '';
  // A linha de DANO sai destrinchada quando o servidor mandou a quebra:
  // `1d8(4)+1d6(2)+DES(+3)=9`. Sem ela, cai no formato antigo.
  const primary =
    entry.kind === 'damage' && entry.breakdown
      ? formatBreakdown(entry.breakdown)
      : `${entry.expression ?? ''}${modifierLabel} = ${entry.total ?? '—'}`;
  return {
    icon: KIND_ICON[entry.kind],
    variant: entry.crit ? `${entry.kind} crit` : entry.kind,
    title,
    primary,
  };
}

function componentNote(modifier: DamageComponentPayload['modifier']): string {
  if (modifier === 'resistance') return 'após resistência';
  if (modifier === 'immunity') return 'imune';
  if (modifier === 'vulnerability') return 'vulnerável ×2';
  return '';
}

interface DetailRow {
  label: string;
  value: string;
}

/** Detalhes expansíveis — apenas campos presentes no payload atual. */
function detailRows(entry: CombatLogEntry): DetailRow[] {
  const rows: DetailRow[] = [];

  if (entry.kind === 'result') {
    rows.push({ label: 'Resultado', value: String(entry.attackTotal ?? '—') });
    rows.push({ label: 'd20', value: String(entry.attackRoll ?? '—') });
    rows.push({ label: 'Bônus', value: formatModifier(entry.attackBonus ?? 0) });
    rows.push({
      label: 'Modo',
      value: entry.advantage ? 'vantagem' : entry.disadvantage ? 'desvantagem' : 'normal',
    });
    rows.push({ label: 'Alvo', value: entry.targetName ?? '—' });
    rows.push({
      label: 'CA',
      value: entry.targetArmorClass === null ? 'oculta' : String(entry.targetArmorClass ?? '—'),
    });

    if (entry.hit) {
      const components = entry.components ?? [];
      if (components.length > 0) {
        rows.push({
          label: 'Dano',
          value: components
            .map((component) => {
              const note = componentNote(component.modifier);
              const line = component.breakdown
                ? formatBreakdown(component.breakdown)
                : component.expression;
              return `${line} ${component.type || 'sem tipo'}${note ? ` (${note})` : ''}`;
            })
            .join('  +  '),
        });
      } else if (entry.damageRolled != null) {
        rows.push({
          label: 'Dano',
          value: `${entry.damageRolled} ${entry.damageType ?? ''}`.trim(),
        });
      }
      if (entry.damageRolled != null) {
        rows.push({ label: 'Total', value: String(entry.damageRolled) });
      }
      if (entry.sneakAttack) {
        rows.push({
          label: 'Ataque Furtivo',
          value: `${entry.sneakAttack.expression} (${entry.sneakAttack.reason})`,
        });
      }
      if (!entry.targetStatsHidden && entry.targetHpCurrent != null) {
        rows.push({
          label: 'HP do alvo',
          value: `${entry.targetHpCurrent}/${entry.targetHpMax ?? '?'}`,
        });
      }
    }
    return rows;
  }

  if (entry.kind === 'turn') {
    rows.push({ label: 'Rodada', value: String(entry.round ?? '—') });
    return rows;
  }

  rows.push({ label: 'Expressão', value: entry.expression ?? '—' });
  if (entry.rolls && entry.rolls.length > 0) {
    rows.push({ label: 'Dados', value: entry.rolls.join(', ') });
  }
  if (entry.modifier) {
    rows.push({ label: 'Modificador', value: formatModifier(entry.modifier) });
  }
  if (entry.total != null) {
    rows.push({ label: 'Total', value: String(entry.total) });
  }
  return rows;
}

/**
 * O QUE ACONTECEU? Página lateral do livro de combate: cada evento vira um
 * cartão compacto, com destaque dourado no mais recente e detalhes que abrem ao
 * clicar. Só exibe o que o payload do socket já traz.
 */
export function CombatLog({ log }: CombatLogProps) {
  return (
    <section className="combat-block combat-log-panel">
      <h3>
        <Icon name="scroll" size={15} /> Registro
      </h3>

      {log.length === 0 ? (
        <p className="empty-hint">Sem eventos ainda.</p>
      ) : (
        <ol className="combat-log">
          {log.map((entry, index) => {
            const view = describeEntry(entry);
            const details = detailRows(entry);
            return (
              <li
                key={entry.id}
                className={`log-card ${view.variant}${index === 0 ? ' recent' : ''}`}
              >
                <details className="log-card-body">
                  <summary className="log-card-summary">
                    <span className="log-card-head">
                      <span className="log-card-icon">
                        <Icon name={view.icon} size={14} />
                      </span>
                      <span className="log-card-actor">{entry.actorName}</span>
                      <span className="log-card-time">
                        {new Date(entry.at).toLocaleTimeString('pt-BR')}
                      </span>
                    </span>
                    <span className="log-card-title">{view.title}</span>
                    <span className="log-card-primary">{view.primary}</span>
                    {view.secondary ? (
                      <span className="log-card-secondary">{view.secondary}</span>
                    ) : null}
                  </summary>

                  {details.length > 0 ? (
                    <div className="log-card-detail">
                      {details.map((row) => (
                        <p key={row.label} className="log-detail-row">
                          <span className="log-detail-label">{row.label}</span>
                          <span className="log-detail-value">{row.value}</span>
                        </p>
                      ))}
                    </div>
                  ) : null}
                </details>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
