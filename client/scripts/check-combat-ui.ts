/**
 * Verificação do REFINO DA UI DE COMBATE (compactação, interatividade e padrão
 * visual). O projeto NÃO tem framework de teste de componentes e não há
 * navegador neste ambiente; então combinamos:
 *
 *   1. Renderização server-side (`react-dom/server`) de `ConditionBadges`, que
 *      é um módulo de apresentação PURO (sem contexto) — cobre as etiquetas,
 *      tooltip e cor semântica;
 *   2. Checagens estáticas nos arquivos-fonte, para garantir que o centro do
 *      combate não reintroduza painéis removidos (Conditions, resultado do
 *      ataque, economia duplicada) e que a barra persistente é quem hospeda as
 *      ações/movimento.
 *
 * Sai com código 1 se qualquer item falhar. Rode com `npm run test:combat-ui`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConditionBadges } from '../src/combat/components/ConditionBadges';
import {
  CONDITION_VISUALS,
  ECONOMY_ACTION_VISUALS,
  conditionDamageFamily,
  conditionDescription,
} from '../src/combat/combatVisuals';
import type { ConditionEffects, MechanicalState } from '../src/types';

const here = dirname(fileURLToPath(import.meta.url));
const source = (relative: string): string =>
  readFileSync(resolve(here, '..', relative), 'utf8');

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown): void {
  if (!condition) failures += 1;
  console.log(
    `  ${condition ? '✔' : '✘'} ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`,
  );
}

/** Efeitos mínimos usados pelas etiquetas (só apresentação). */
function effectsOf(labels: Record<string, string>, extra: Partial<ConditionEffects> = {}): ConditionEffects {
  return {
    exhaustionEnabled: true,
    exhaustionSummary: [],
    assistedNotes: [],
    labels,
    active: Object.keys(labels),
    canAct: true,
    canReact: true,
    canBonusAct: true,
    incapacitated: false,
    prone: false,
    speedZero: false,
    poisonSuspended: false,
    fatalByExhaustion: false,
    fearRequiresLineOfSight: false,
    proximityCritical: false,
    proneTargetRequiresDistance: false,
    sightChecksAutoFail: false,
    hearingChecksAutoFail: false,
    dropsHeldObjects: false,
    ...extra,
  };
}

function stateOf(conditions: string[], exhaustionLevel = 0): MechanicalState {
  return {
    conditions: conditions.map((condition, index) => ({
      id: `c${index}`,
      condition,
      sourceLabel: 'Teste',
      appliedAt: '2026-10-12T00:00:00.000Z',
    })),
    exhaustionLevel,
    log: [],
  };
}

const LABELS: Record<string, string> = {
  blinded: 'Cego',
  charmed: 'Enfeitiçado',
  deafened: 'Surdo',
  frightened: 'Amedrontado',
  grappled: 'Agarrado',
  incapacitated: 'Incapacitado',
  invisible: 'Invisível',
  paralyzed: 'Paralisado',
  petrified: 'Petrificado',
  poisoned: 'Envenenado',
  prone: 'Caído',
  restrained: 'Contido',
  stunned: 'Atordoado',
  unconscious: 'Inconsciente',
};

console.log('Check-combat-ui — refino da UI de combate');

// --- A. A condição aparece associada (o card recebe o estado do combatente) --
{
  const markup = renderToStaticMarkup(
    ConditionBadges({ state: stateOf(['poisoned']), effects: effectsOf(LABELS) }),
  );
  check('A) etiqueta da condição aparece com o nome vindo do servidor', markup.includes('Envenenado'));
}

// --- B. O tooltip usa a descrição PHB 2014 da condição ----------------------
{
  const markup = renderToStaticMarkup(
    ConditionBadges({ state: stateOf(['poisoned']), effects: effectsOf(LABELS) }),
  );
  const description = conditionDescription('poisoned');
  check('B) hover na etiqueta mostra a descrição correspondente', markup.includes(description), description);
  check('B) etiqueta não exige ícone "i"', !markup.includes('info-tip-icon'));
}

// --- C. Poisoned usa a família visual de Poison -----------------------------
{
  check('C) Envenenado referencia a família de dano Veneno', conditionDamageFamily('poisoned') === 'poison');
  const markup = renderToStaticMarkup(
    ConditionBadges({ state: stateOf(['poisoned']), effects: effectsOf(LABELS) }),
  );
  check('C) chip carrega data-condition e data-damage-family', markup.includes('data-condition="poisoned"') && markup.includes('data-damage-family="poison"'));
}

// --- D. Condição sem relação com dano recebe cor própria --------------------
{
  check('D) Caído não força família de dano', conditionDamageFamily('prone') === null);
  const markup = renderToStaticMarkup(
    ConditionBadges({ state: stateOf(['prone']), effects: effectsOf(LABELS) }),
  );
  check('D) chip de Caído tem data-condition e NENHUMA família de dano', markup.includes('data-condition="prone"') && !markup.includes('data-damage-family'));
}

// --- Overflow: muitas condições resumem em "+N" -----------------------------
{
  const markup = renderToStaticMarkup(
    ConditionBadges({
      state: stateOf(['poisoned', 'prone', 'stunned', 'blinded', 'restrained', 'frightened']),
      effects: effectsOf(LABELS),
    }),
  );
  check('Condições: 6 viram 4 etiquetas + "+2"', markup.includes('+2'));
}

// --- E–H. A barra persistente hospeda Ação e Deslocamento -------------------
{
  const bar = source('src/combat/components/TurnResourceBar.tsx');
  const tracker = source('src/combat/CombatTracker.tsx');
  check('E) barra persistente renderiza o menu de Ação', bar.includes('<ActionMenu'));
  check('F) menu lista as ações suportadas', ['dash', 'disengage', 'dodge', 'hide', 'ready'].every((id) => ECONOMY_ACTION_VISUALS.some((item) => item.id === id)));
  check('G) deslocamento tem popover inline', bar.includes('move-popover'));
  check('H) gasto de movimento envia a distância ao mecanismo existente', bar.includes("action: 'move'") && bar.includes('onSpend') && tracker.includes('executeEconomyAction'));
}

// --- I–L. O centro não duplica o que já tem lugar próprio -------------------
{
  const tracker = source('src/combat/CombatTracker.tsx');
  check('I) resultado do ataque não é mais exibido no centro', !tracker.includes('AttackResultPanel'));
  check('J) o Registro continua recebendo o ataque resolvido', source('src/combat/useCombatState.ts').includes('onAttackResolved') && source('src/combat/components/CombatLog.tsx').includes("entry.kind === 'result'"));
  check('K) sem painel separado de Conditions no centro (etiquetas vivem no card)', !tracker.includes('ConditionBadges') && tracker.includes('combat-status'));
  check('L) sem painel duplicado de Action Economy no centro', !tracker.includes('EconomyControls'));
}

// --- Coerência do source of truth visual ------------------------------------
{
  check('Toda condição do PHB 2014 tem descrição', Object.keys(LABELS).every((id) => (CONDITION_VISUALS[id]?.description ?? '').length > 0));
  check('Só Envenenado compartilha família com tipo de dano', Object.entries(CONDITION_VISUALS).filter(([, value]) => value.damageFamily).map(([id]) => id).join(',') === 'poisoned');
}

console.log(failures === 0 ? '\nOK — todos os itens passaram.' : `\nFALHOU — ${failures} item(ns).`);
if (failures > 0) process.exit(1);
