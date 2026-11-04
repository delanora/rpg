import type { Prisma } from '@prisma/client';
import type { AbilityKey } from '../../shared/dnd5e.js';
import type { SpellCastingTimeKind } from '../../shared/spells/types.js';
import type { LoadedEntity } from '../../mechanical/mechanical.service.js';
import type { SpellcastingProfile } from './spellcasting-source.js';
import type { CastingResource } from './casting-resource.js';
import type { SpellTargetingDefinition } from './spell-targeting.js';
import type { TargetingSnapshot } from './spell-targeting.service.js';
import type { SpellDurationDefinition } from './spell-duration.js';

/**
 * FASE 6.6A — SPELL EXECUTION DEFINITION.
 *
 * Diz COMO uma magia resolve mecanicamente. NÃO copia nome/escola/nível/texto/
 * componentes do catálogo descritivo e NÃO descreve o estado durável — isso é
 * responsabilidade da Effect Definition referenciada por id.
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
  /** Nível da magia no catálogo (0 = truque). */
  spellLevel: number;
  /** Nível em que a conjuração acontece (vem do espaço escolhido). */
  castAtLevel: number;
  /** Espaço que será gasto no commit (`null` em truques). */
  castingResource: CastingResource | null;
  /** Custo de Action Economy derivado do casting time (`null` = não executável). */
  economyCost: 'action' | 'bonus-action' | 'reaction';
  /** Snapshot da validação de alvos (quantidade/alcance/visão). */
  targeting: TargetingSnapshot;
}

export interface SpellExecutionDefinition {
  /** Id canônico do catálogo (`bless`, `hold-person`). */
  spellId: string;
  requiresConcentration: boolean;
  /**
   * 6.6I — APRESENTAÇÃO do card de salvaguarda INICIAL no log lateral.
   * Metadado curto e próprio da magia (nunca o texto integral do catálogo e
   * nunca parseado): a mecânica continua vindo de `resolution`.
   */
  combatPrompt?: string;
  /**
   * 6.6I — APRESENTAÇÃO da salvaguarda REPETIDA (fim do turno). Opcional: sem
   * ele o card usa o texto padrão de "tentar romper".
   */
  ongoingPrompt?: string;
  /**
   * DURAÇÃO (6.6H): dado ESTRUTURADO (kind/amount/unit), nunca parseado do
   * texto da magia. Ausente = sem duração acompanhada nesta engine.
   */
  duration?: SpellDurationDefinition;
  /**
   * CASTING TIME (6.6D). Opcional de propósito: quando ausente, o serviço usa o
   * `castingTimeKind` do CATÁLOGO (fonte única). Só sobrescreva quando uma
   * feature/metamágica mudar o tempo antes do COMMIT.
   */
  castingTime?: SpellCastingTimeKind;
  /**
   * TARGETING (6.6E): quantidade de alvos, alcance, visão, caminho livre,
   * filtros e restrições de grupo. Substitui o antigo `maxTargets` fixo — o
   * máximo agora é DERIVADO do espaço usado no cast.
   */
  targeting: SpellTargetingDefinition;
  resolution: SpellResolutionDefinition;
  /**
   * Validação EXTRA específica da magia, quando os filtros declarativos não
   * bastarem. Roda depois do targeting genérico e ANTES do commit — nunca muta
   * o banco.
   */
  validateTargets?: (context: SpellValidationContext) => Promise<void> | void;
}
