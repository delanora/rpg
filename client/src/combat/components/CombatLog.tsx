import { Icon, type IconName } from '../../components/Icon';
import { formatModifier } from '../../dnd';
import type { DamageBreakdownPayload } from '../../types';
import type { CombatLogEntry } from '../useCombatState';
import { DamageComponent } from './DamageComponent';

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

/** Resumo curto de uma quebra ainda sem apresentação própria (uso defensivo). */
function formatBreakdown(breakdown: DamageBreakdownPayload): string {
  const parts = breakdown.parts.map((part) =>
    part.rolls.length > 0
      ? `${part.label}(${part.rolls.join('+')})`
      : `${part.label}(${formatModifier(part.value)})`,
  );
  return `${parts.join('+')}=${breakdown.total}`;
}

interface EntryView {
  icon: IconName;
  variant: string;
  title: string;
  primary: string;
  secondary?: string;
}

/** Linha curta dos eventos simples (iniciativa, turno). */
function describeEntry(entry: CombatLogEntry): EntryView {
  if (entry.kind === 'turn') {
    return {
      icon: KIND_ICON.turn,
      variant: 'turn',
      title: 'Início de turno',
      primary: `Rodada ${entry.round ?? '—'}`,
    };
  }

  const title = entry.kind === 'initiative' ? 'Iniciativa' : entry.kind === 'attack' ? 'Ataque' : 'Dano';
  const modifierLabel =
    entry.modifier && entry.modifier !== 0
      ? ` ${entry.modifier > 0 ? `+${entry.modifier}` : entry.modifier}`
      : '';
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

interface DetailRow {
  label: string;
  value: string;
}

/** Detalhes expansíveis dos eventos simples. */
function detailRows(entry: CombatLogEntry): DetailRow[] {
  const rows: DetailRow[] = [];
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

/** Desfecho do ataque, com o rótulo e a classe visual correspondentes. */
function outcomeOf(entry: CombatLogEntry): { key: string; label: string } {
  if (entry.critical) return { key: 'crit', label: 'CRÍTICO!' };
  if (entry.naturalOne) return { key: 'fail', label: 'FALHA CRÍTICA' };
  if (entry.hit) return { key: 'hit', label: 'ACERTO' };
  return { key: 'miss', label: 'ERROU' };
}

/**
 * CARTÃO DE ATAQUE — um único evento visual lógico para ataque + dano.
 *
 * Nível principal: quem atacou, com o quê, o desfecho (total vs CA), o dano por
 * tipo e a composição fonte a fonte. Nível detalhado (`<details>`): a rolagem
 * de ataque (d20, modo, bônus, CA) e as observações do servidor. Tudo vem do
 * payload — nada é recalculado.
 */
function AttackCard({ entry, recent }: { entry: CombatLogEntry; recent: boolean }) {
  const outcome = outcomeOf(entry);
  const ca = entry.targetArmorClass === null ? 'CA oculta' : `CA ${entry.targetArmorClass}`;
  const components = entry.components ?? [];
  const rolls = entry.attackRolls ?? [];
  const rollLabel =
    rolls.length > 0 ? rolls.map((roll) => `[${roll}]`).join(' ') : `[${entry.attackRoll ?? '—'}]`;

  return (
    <li className={`log-card result ${outcome.key}${recent ? ' recent' : ''}`}>
      <article className="attack-card">
        <header className="attack-card-head">
          <span className="attack-card-actor">
            <Icon name="sword" size={14} />
            <span>{entry.actorName}</span>
          </span>
          <span className="attack-card-time">{new Date(entry.at).toLocaleTimeString('pt-BR')}</span>
        </header>

        <p className="attack-card-weapon">
          {entry.attackName ?? 'Ataque'}
          {entry.targetName ? <span className="attack-card-target"> → {entry.targetName}</span> : null}
        </p>

        <p className={`attack-card-outcome ${outcome.key}`}>
          <span className="attack-card-vs">
            {entry.attackTotal} vs {ca}
          </span>
          <span className={`attack-result-outcome ${outcome.key}`}>{outcome.label}</span>
        </p>

        {entry.hit ? (
          <div className="attack-card-damage">
            <span className="attack-card-label">Dano</span>
            {components.length > 0 ? (
              <>
                <div className="attack-card-components">
                  {components.map((component, index) => (
                    <DamageComponent key={`${component.type}-${index}`} component={component} />
                  ))}
                </div>
                <p className="attack-card-total">
                  <span className="attack-card-total-label">TOTAL</span>
                  <span className="attack-card-total-value">{entry.damageRolled}</span>
                </p>
              </>
            ) : (
              <p className="attack-card-flat">
                {entry.damageRolled} {entry.damageType}
              </p>
            )}
          </div>
        ) : null}

        <details className="attack-card-details">
          <summary>▸ Detalhes da rolagem</summary>
          <div className="attack-card-detail-body">
            <p className="log-detail-row">
              <span className="log-detail-label">Ataque</span>
              <span className="log-detail-value">d20 → {rollLabel}</span>
            </p>
            {rolls.length > 1 ? (
              <p className="log-detail-row">
                <span className="log-detail-label">Usado</span>
                <span className="log-detail-value">{entry.attackRoll}</span>
              </p>
            ) : null}
            <p className="log-detail-row">
              <span className="log-detail-label">Modo</span>
              <span className="log-detail-value">
                {entry.advantage ? 'vantagem' : entry.disadvantage ? 'desvantagem' : 'normal'}
              </span>
            </p>
            <p className="log-detail-row">
              <span className="log-detail-label">Bônus</span>
              <span className="log-detail-value">{formatModifier(entry.attackBonus ?? 0)}</span>
            </p>
            <p className="log-detail-row">
              <span className="log-detail-label">Total</span>
              <span className="log-detail-value">{entry.attackTotal ?? '—'}</span>
            </p>
            <p className="log-detail-row">
              <span className="log-detail-label">Alvo</span>
              <span className="log-detail-value">{entry.targetName ?? '—'}</span>
            </p>
            <p className="log-detail-row">
              <span className="log-detail-label">CA</span>
              <span className="log-detail-value">
                {entry.targetArmorClass === null ? 'oculta' : String(entry.targetArmorClass ?? '—')}
              </span>
            </p>
            {entry.sneakAttack ? (
              <p className="log-detail-row">
                <span className="log-detail-label">Furtivo</span>
                <span className="log-detail-value">
                  {entry.sneakAttack.expression} ({entry.sneakAttack.reason})
                </span>
              </p>
            ) : null}
            {!entry.targetStatsHidden && entry.targetHpCurrent != null ? (
              <p className="log-detail-row">
                <span className="log-detail-label">HP do alvo</span>
                <span className="log-detail-value">
                  {entry.targetHpCurrent}/{entry.targetHpMax ?? '?'}
                </span>
              </p>
            ) : null}
          </div>
        </details>
      </article>
    </li>
  );
}

/**
 * O QUE ACONTECEU? Página lateral do livro de combate. O ataque e o dano viram
 * UM cartão estruturado; iniciativa e turno continuam cartões simples.
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
            const recent = index === 0;
            if (entry.kind === 'result') {
              return <AttackCard key={entry.id} entry={entry} recent={recent} />;
            }
            const view = describeEntry(entry);
            const details = detailRows(entry);
            return (
              <li key={entry.id} className={`log-card ${view.variant}${recent ? ' recent' : ''}`}>
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
