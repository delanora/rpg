import { HttpError } from '../../../lib/http-error.js';
import { isHumanoidEntity } from '../../shared/creature-types.js';
import {
  BLESS_DEFINITION_ID,
  BLESS_MAX_TARGETS,
  BLESS_SPELL_ID,
} from '../../effects/definitions/bless.js';
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
 * As definições compõem o contrato com validações específicas (limite de alvos,
 * humanoide) e mantêm a CD manual enquanto a 6.6B não deriva o Spell Save DC.
 */
export const SPELL_EXECUTION_DEFINITIONS: Record<string, SpellExecutionDefinition> = {
  [BLESS_SPELL_ID]: {
    spellId: BLESS_SPELL_ID,
    requiresConcentration: true,
    maxTargets: BLESS_MAX_TARGETS,
    resolution: {
      kind: 'immediate-effect',
      effectDefinitionId: BLESS_DEFINITION_ID,
    },
    validateTargets: ({ targets }) => {
      // O limite de 1..3 é regra da CONJURAÇÃO, não da rota HTTP.
      if (targets.length < 1 || targets.length > BLESS_MAX_TARGETS) {
        throw new HttpError(
          `Bless exige de 1 a ${BLESS_MAX_TARGETS} alvos.`,
          400,
          'VALIDATION_ERROR',
        );
      }
    },
  },
  [HOLD_PERSON_SPELL_ID]: {
    spellId: HOLD_PERSON_SPELL_ID,
    requiresConcentration: true,
    maxTargets: 1,
    // CD manual de prova: a Spell Execution Engine derivará 8 + proficiência +
    // atributo na 6.6B. O payload de prova não escolhe atributo nem Condition.
    manualSaveDc: true,
    resolution: {
      kind: 'save-effect',
      ability: HOLD_PERSON_SAVE_ABILITY,
      effectDefinitionId: HOLD_PERSON_DEFINITION_ID,
      applyOn: 'failure',
    },
    validateTargets: async ({ db, targets, caster }) => {
      if (targets.length !== 1) {
        throw new HttpError(
          'Imobilizar Pessoa afeta exatamente um alvo nesta fase.',
          400,
          'VALIDATION_ERROR',
        );
      }
      const target = targets[0];
      if (!(await isHumanoidEntity(target.entity, db))) {
        throw new HttpError(
          'Imobilizar Pessoa só afeta humanoides.',
          409,
          'HOLD_PERSON_TARGET_NOT_HUMANOID',
        );
      }
      // Caster e alvo usam a mesma canonicalização do resto do domínio.
      if (caster.entity.kind === 'creature' && target.entity.kind === 'creature') {
        return;
      }
    },
  },
};

/** Definição executável da magia (`null` = catálogo sem execução implementada). */
export function spellExecutionDefinition(spellId: string): SpellExecutionDefinition | null {
  return SPELL_EXECUTION_DEFINITIONS[spellId] ?? null;
}
