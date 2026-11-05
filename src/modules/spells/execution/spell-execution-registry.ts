import { BLESS_DEFINITION_ID, BLESS_SPELL_ID } from '../../effects/definitions/bless.js';
import {
  HOLD_PERSON_DEFINITION_ID,
  HOLD_PERSON_SAVE_ABILITY,
  HOLD_PERSON_SPELL_ID,
} from '../../effects/definitions/hold-person.js';
import type { SpellExecutionDefinition } from './spell-execution-definition.js';
import {
  SACRED_FLAME_BASE_DICE,
  SACRED_FLAME_DAMAGE_TYPE,
  SACRED_FLAME_IGNORE_SAVE_COVER,
  SACRED_FLAME_LABEL,
  SACRED_FLAME_SAVE_ABILITY,
  SACRED_FLAME_SCALING,
  SACRED_FLAME_SPELL_ID,
} from './sacred-flame.js';

/**
 * FASE 6.6A — REGISTRY de magias EXECUTÁVEIS.
 *
 * A chave é o `spellId` canônico do catálogo. O serviço de cast resolve
 * `spellId → definição`; nenhum `switch (spellId)` no núcleo. Só entram aqui as
 * magias cujo comportamento mecânico já foi PROVADO (Bless e Hold Person) —
 * existir no catálogo NÃO torna a magia executável (`SPELL_EXECUTION_NOT_IMPLEMENTED`).
 *
 * Desde a 6.6E o TARGETING é declarativo: cada definição diz quantidade base,
 * progressão por espaço, alcance em PÉS, visão/caminho livre, filtros e
 * restrições de grupo. Nenhuma dessas regras mora no `spell-cast.service`, e o
 * máximo de alvos é derivado do espaço escolhido (nunca do cliente).
 *
 * PHB 2014:
 *  • Bless — 30 ft, até 3 criaturas à sua escolha, +1 por espaço acima do 1º;
 *    NÃO exige ver o alvo; exige caminho livre.
 *  • Hold Person — 60 ft, humanoides que o conjurador possa VER, +1 por espaço
 *    acima do 2º; alvos a até 30 ft uns dos outros; caminho livre.
 *  • Chama Sagrada — truque, 60 ft, UMA criatura que o conjurador veja, save de
 *    Destreza e 1d8 radiante (2d8/3d8/4d8 pelo nível TOTAL de personagem).
 *    Instantânea: sem Effect, sem Concentração, sem espaço e sem cobertura.
 *
 * A CD de magia continua fora daqui: vem do perfil de conjuração do caster.
 */
export const SPELL_EXECUTION_DEFINITIONS: Record<string, SpellExecutionDefinition> = {
  [BLESS_SPELL_ID]: {
    spellId: BLESS_SPELL_ID,
    requiresConcentration: true,
    // PHB 2014: "Concentration, up to 1 minute" → 10 rounds em combate.
    duration: { kind: 'timed', amount: 1, unit: 'minute' },
    targeting: {
      kind: 'creatures',
      minTargets: 1,
      targetCount: { base: 3, baseSlotLevel: 1, additionalPerSlotLevel: 1 },
      range: { kind: 'distance', feet: 30 },
      // O caster pode ser um dos alvos e qualquer criatura escolhida serve.
      allowSelf: true,
      requiresSight: false,
      requiresClearPath: true,
      filters: [],
      groupConstraints: [],
    },
    resolution: {
      kind: 'immediate-effect',
      effectDefinitionId: BLESS_DEFINITION_ID,
    },
  },
  [HOLD_PERSON_SPELL_ID]: {
    spellId: HOLD_PERSON_SPELL_ID,
    requiresConcentration: true,
    // 6.6I: descrição CURTA do card de salvaguarda no registro lateral (a
    // mecânica continua só em `resolution`; o texto do catálogo nunca é usado).
    combatPrompt: 'Uma força mágica tenta paralisar seu corpo.',
    ongoingPrompt: 'Você pode tentar romper a magia.',
    // PHB 2014: "Concentration, up to 1 minute" → 10 rounds em combate.
    duration: { kind: 'timed', amount: 1, unit: 'minute' },
    targeting: {
      kind: 'creatures',
      minTargets: 1,
      targetCount: { base: 1, baseSlotLevel: 2, additionalPerSlotLevel: 1 },
      range: { kind: 'distance', feet: 60 },
      allowSelf: true,
      requiresSight: true,
      requiresClearPath: true,
      filters: [{ kind: 'creature-type', value: 'humanoid' }],
      groupConstraints: [{ kind: 'mutual-distance', feet: 30 }],
    },
    // O payload de prova não escolhe atributo, CD nem Condition: a CD vem do
    // perfil do caster e o atributo da definição da magia.
    resolution: {
      kind: 'save-effect',
      ability: HOLD_PERSON_SAVE_ABILITY,
      effectDefinitionId: HOLD_PERSON_DEFINITION_ID,
      applyOn: 'failure',
    },
  },
  [SACRED_FLAME_SPELL_ID]: {
    spellId: SACRED_FLAME_SPELL_ID,
    // Instantânea: nenhum Effect persistente, nenhuma Concentração.
    requiresConcentration: false,
    combatPrompt: 'Uma radiância flamejante desce sobre você.',
    // PHB 2014: 1 ação, 18 m (60 pés), V/S, uma criatura que o caster veja.
    // Sem área, sem filtro de tipo e sem restrição de grupo; o caster pode ser
    // alvo porque o texto não o proíbe.
    targeting: {
      kind: 'creatures',
      minTargets: 1,
      targetCount: { base: 1, baseSlotLevel: 0, additionalPerSlotLevel: 0 },
      range: { kind: 'distance', feet: 60 },
      allowSelf: true,
      requiresSight: true,
      requiresClearPath: true,
      filters: [],
      groupConstraints: [],
    },
    resolution: {
      kind: 'save-damage',
      ability: SACRED_FLAME_SAVE_ABILITY,
      onSuccess: 'none',
      damage: {
        type: SACRED_FLAME_DAMAGE_TYPE,
        dice: SACRED_FLAME_BASE_DICE,
        scaling: SACRED_FLAME_SCALING,
      },
      ignoreSaveCover: SACRED_FLAME_IGNORE_SAVE_COVER,
    },
  },
};

/** Nome exibível da magia executável (a apresentação nunca decide regra). */
export function spellDisplayLabel(spellId: string): string | null {
  return spellId === SACRED_FLAME_SPELL_ID ? SACRED_FLAME_LABEL : null;
}

/** Definição executável da magia (`null` = catálogo sem execução implementada). */
export function spellExecutionDefinition(spellId: string): SpellExecutionDefinition | null {
  return SPELL_EXECUTION_DEFINITIONS[spellId] ?? null;
}
