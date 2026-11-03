import type { Prisma } from '@prisma/client';
import type { AbilityKey } from '../../shared/dnd5e.js';
import type { LoadedEntity } from '../../mechanical/mechanical.service.js';
import type { SpellcastingProfile } from './spellcasting-source.js';

/**
 * FASE 6.6A — SPELL EXECUTION DEFINITION.
 *
 * Diz COMO uma magia resolve mecanicamente. NÃO copia nome/escola/nível/texto/
 * alcance/componentes do catálogo descritivo e NÃO descreve o estado durável —
 * isso é responsabilidade da Effect Definition referenciada por id.
 *
 * Dois padrões reais nesta fase (os mesmos já provados por Bless e Hold Person):
 *  • `immediate-effect` — a conjuração produz o efeito na hora;
 *  • `save-effect` — o alvo faz uma salvaguarda e o efeito só entra na FALHA.
 *
 * `spell-attack` fica para quando Spell Attack/DC estiverem formalizados.
 */
export type SpellResolutionDefinition =
  | {
      kind: 'immediate-effect';
      effectDefinitionId: string;
    }
  | {
      kind: 'save-effect';
      ability: AbilityKey;
      effectDefinitionId: string;
      applyOn: 'failure';
    };

/** Contexto de validação (read-only) entregue ao hook da definição. */
export interface SpellValidationContext {
  db: Prisma.TransactionClient;
  spellId: string;
  caster: LoadedEntity;
  targets: LoadedEntity[];
  /** Perfil SERVER-SIDE da conjuração (fonte/atributo/CD/ataque mágico). */
  profile: SpellcastingProfile;
  /** CD de magia do perfil (sempre presente). */
  saveDc: number;
}

export interface SpellExecutionDefinition {
  /** Id canônico do catálogo (`bless`, `hold-person`). */
  spellId: string;
  requiresConcentration: boolean;
  maxTargets: number;
  resolution: SpellResolutionDefinition;
  /**
   * Validação ESPECÍFICA da magia (alvo humanoide, limite de alvos...).
   * Roda depois da validação genérica e ANTES do commit — nunca muta o banco.
   */
  validateTargets?: (context: SpellValidationContext) => Promise<void> | void;
}
