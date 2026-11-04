import { BLESS_DEFINITION_ID, BLESS_SPELL_ID } from '../../effects/definitions/bless.js';
import {
  HOLD_PERSON_DEFINITION_ID,
  HOLD_PERSON_SAVE_ABILITY,
  HOLD_PERSON_SPELL_ID,
} from '../../effects/definitions/hold-person.js';
import type { SpellExecutionDefinition } from './spell-execution-definition.js';

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
};

/** Definição executável da magia (`null` = catálogo sem execução implementada). */
export function spellExecutionDefinition(spellId: string): SpellExecutionDefinition | null {
  return SPELL_EXECUTION_DEFINITIONS[spellId] ?? null;
}
