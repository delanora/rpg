import type { ClassFeatureEffect } from '../classes/types.js';

/**
 * Recursos RACIAIS limitados do PHB 2014 (5.3E.1).
 *
 * Este módulo é a fundação própria da RAÇA para contadores — deliberadamente
 * SEPARADO do motor de classes (`shared/classes`): a raça não é uma classe, não
 * existe `fakeClass = 'race'` e nada aqui passa por `computeClassAdjustments`.
 * Só a abstração de "recurso com contador" é compartilhada conceitualmente
 * (mesma ideia de `ActiveResource`), com um campo `origin: 'race'` que deixa a
 * origem explícita para a UI/API.
 *
 * Fonte de verdade:
 * • PERSISTIDO: `racialState.used[resourceId]` (só os usos GASTOS);
 * • DERIVADO: nome, máximo, recarga, disponibilidade e `remaining`.
 *
 * Fora de escopo nesta fase (Fase 6): executar dano/save/área das magias e do
 * sopro, efeitos, concentração, motor de morte e o gatilho de 0 PV da
 * Resistência Implacável.
 */

/** Recarga operacional de um recurso racial. */
export type RacialResourceRecharge = 'short' | 'long';

/** Como o recurso é consumido — puramente informativo para a UI nesta fase. */
export type RacialResourceActionType = 'action' | 'bonus-action' | 'manual';

/** Definição de catálogo de UM recurso racial limitado. */
export interface RacialResourceDefinition {
  /** Identificador estável (ex.: 'breath-weapon', 'tiefling-hellish-rebuke'). */
  id: string;
  /** Nome em português para a ficha. */
  name: string;
  /** Máximo FIXO de usos (nenhum recurso racial escala com o nível hoje). */
  max: number;
  /** Quando os usos voltam. Breath Weapon = curto; o resto = longo (ver notas). */
  recharge: RacialResourceRecharge;
  /** Nível de PERSONAGEM a partir do qual o recurso é concedido (padrão 1). */
  minLevel?: number;
  /** Como o jogador o aciona (a resolução mecânica é manual nesta fase). */
  actionType?: RacialResourceActionType;
  /** Id do traço racial que concede o recurso (informativo/UI). */
  traitId?: string;
  /** Id da magia racial associada, quando houver (catálogo `shared/spells`). */
  spellId?: string;
  /** Nota de regra exibida na UI/relatórios (ex.: decisão de once/day). */
  notes?: string;
}

/**
 * Draconato — Arma de Sopro (PHB 2014, p. 34).
 *
 * Recharge PHB 2014: "não pode usar de novo até completar um descanso curto ou
 * longo" → recarga CURTA (um descanso longo também a satisfaz). A resolução
 * mecânica (formato/área, dados por nível total, CD e salvaguarda) continua
 * MANUAL nesta fase — o sistema só controla disponibilidade, uso e recarga.
 */
const DRAGONBORN: RacialResourceDefinition[] = [
  {
    id: 'breath-weapon',
    name: 'Arma de Sopro',
    max: 1,
    recharge: 'short',
    actionType: 'action',
    traitId: 'breath-weapon',
    notes:
      'PHB 2014: recarrega num descanso curto ou longo. Dano, área, CD e salvaguarda ' +
      'são resolvidos manualmente nesta fase (motor da Fase 6).',
  },
];

/**
 * Meio-Orc — Resistência Implacável (PHB 2014, p. 41): 1×/descanso longo.
 *
 * Nesta fase o uso é MANUAL e NÃO altera PV: o gatilho automático de "caiu a 0
 * PV" pertence à Fase 6.3 (0 PV/morte/estabilização). Documentado como transição
 * futura.
 */
const HALF_ORC: RacialResourceDefinition[] = [
  {
    id: 'relentless-endurance',
    name: 'Resistência Implacável',
    max: 1,
    recharge: 'long',
    actionType: 'manual',
    traitId: 'relentless-endurance',
    notes:
      'PHB 2014: 1×/descanso longo. Marcação MANUAL nesta fase; não altera PV. O gatilho ' +
      'automático de "cair a 0 PV" pertence à Fase 6.3.',
  },
];

/**
 * Tiefling — Legado Infernal (PHB 2014, p. 43).
 *
 * O truque (Taumaturgia) é À VONTADE e NÃO gera recurso. As duas magias
 * limitadas usam o PHB 2014 "once per day" → DECISÃO DO PROJETO: recarga LONG
 * ("PHB 2014 once/day mapped to Long Rest by project decision").
 */
const TIEFLING: RacialResourceDefinition[] = [
  {
    id: 'tiefling-hellish-rebuke',
    name: 'Repreensão Infernal',
    max: 1,
    recharge: 'long',
    minLevel: 3,
    actionType: 'manual',
    traitId: 'infernal-legacy',
    spellId: 'hellish-rebuke',
    notes: 'PHB 2014 once/day mapped to Long Rest by project decision.',
  },
  {
    id: 'tiefling-darkness',
    name: 'Escuridão (Legado Infernal)',
    max: 1,
    recharge: 'long',
    minLevel: 5,
    actionType: 'manual',
    traitId: 'infernal-legacy',
    spellId: 'darkness',
    notes: 'PHB 2014 once/day mapped to Long Rest by project decision.',
  },
];

/**
 * Drow — Magia Drow (PHB 2014, p. 24).
 *
 * Luzes Dançantes é um truque À VONTADE e NÃO gera recurso. Fogo das Fadas (3º
 * nível de personagem) e Escuridão (5º) usam "once per day" → recarga LONG por
 * decisão do projeto, com um recurso PRÓPRIO para cada magia (usos
 * independentes).
 */
const DROW: RacialResourceDefinition[] = [
  {
    id: 'drow-faerie-fire',
    name: 'Fogo das Fadas',
    max: 1,
    recharge: 'long',
    minLevel: 3,
    actionType: 'manual',
    traitId: 'drow-magic',
    spellId: 'faerie-fire',
    notes: 'PHB 2014 once/day mapped to Long Rest by project decision.',
  },
  {
    id: 'drow-darkness',
    name: 'Escuridão (Magia Drow)',
    max: 1,
    recharge: 'long',
    minLevel: 5,
    actionType: 'manual',
    traitId: 'drow-magic',
    spellId: 'darkness',
    notes: 'PHB 2014 once/day mapped to Long Rest by project decision.',
  },
];

/**
 * Catálogo por chave de raça/sub-raça (`raceId` ou `raceId/subraceId`).
 *
 * Só entram aqui os recursos LIMITADOS. Features PASSIVAS (visão no escuro,
 * proficiências, resistências), À VONTADE (truques raciais) e dependentes de
 * motor (Sortudo do Halfling, Ataques Selvagens do Meio-Orc) NÃO são recursos.
 * Raças personalizadas (CustomRace) ainda NÃO modelam recursos — ver limitação
 * no relatório.
 */
const CATALOG: Readonly<Record<string, readonly RacialResourceDefinition[]>> = {
  dragonborn: DRAGONBORN,
  'half-orc': HALF_ORC,
  tiefling: TIEFLING,
  'elf/drow-elf': DROW,
};

/** Entrada mínima para resolver os recursos raciais de uma ficha. */
export interface RacialResolutionInput {
  raceId?: string | null;
  subraceId?: string | null;
}

/** Chave do catálogo para a raça/sub-raça atual (ou `null` sem raça). */
function catalogKey(input: RacialResolutionInput): string | null {
  if (!input.raceId) return null;
  return input.subraceId ? `${input.raceId}/${input.subraceId}` : input.raceId;
}

/**
 * Definições de recurso CONCEDIDAS pela raça/sub-raça atual no nível TOTAL do
 * personagem. ORDEM de exibição preservada; filtra pelo `minLevel`.
 */
export function racialResourceDefinitions(
  input: RacialResolutionInput,
  totalLevel = 1,
): RacialResourceDefinition[] {
  const key = catalogKey(input);
  if (!key) return [];
  const level = Math.max(1, Math.floor(totalLevel));
  return (CATALOG[key] ?? []).filter((definition) => (definition.minLevel ?? 1) <= level);
}

/**
 * Estado de runtime dos recursos RACIAIS. Mínimo de propósito: só os usos
 * gastos. Não há `active` (as ações raciais são INSTANTÂNEAS: o sopro e as
 * magias não deixam toggle pendurado) nem `choices` nesta fase.
 */
export interface RacialState {
  used: Record<string, number>;
}

/**
 * Normaliza o `racialState` vindo do JSONB. DADOS MALFORMADOS nunca quebram a
 * ficha: `used` sempre vira objeto, os valores precisam ser inteiros finitos
 * >= 0 (senão a chave é descartada) e as frações são truncadas. Chaves
 * desconhecidas são PRESERVADAS aqui — quem remove órfãos é a reconciliação.
 */
export function normalizeRacialState(input: unknown): RacialState {
  const source = (input ?? {}) as { used?: unknown };
  const used: Record<string, number> = {};
  if (source.used && typeof source.used === 'object') {
    for (const [key, value] of Object.entries(source.used as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        used[key] = Math.floor(value);
      }
    }
  }
  return { used };
}

/** Um recurso racial DERIVADO (o que a ficha/API exibem). */
export interface RacialResource {
  id: string;
  name: string;
  /** Marca de ORIGEM — a raça não é uma classe (5.3E.1). */
  origin: 'race';
  recharge: RacialResourceRecharge;
  max: number;
  used: number;
  remaining: number;
  actionType?: RacialResourceActionType;
  traitId?: string;
  /** Id da magia racial associada (`shared/spells`), quando houver. */
  spellId?: string;
  notes?: string;
}

/**
 * Recursos raciais DERIVADOS da ficha: cruza o catálogo com os usos persistidos.
 * O `used` EFETIVO nunca passa do `max` (clamp na LEITURA); o `max`/`remaining`
 * NUNCA são persistidos.
 */
export function racialResources(
  input: RacialResolutionInput,
  state: RacialState,
  totalLevel = 1,
): RacialResource[] {
  return racialResourceDefinitions(input, totalLevel).map((definition) => {
    const persisted = Math.max(0, state.used[definition.id] ?? 0);
    const used = Math.min(persisted, definition.max);
    return {
      id: definition.id,
      name: definition.name,
      origin: 'race',
      recharge: definition.recharge,
      max: definition.max,
      used,
      remaining: Math.max(0, definition.max - used),
      ...(definition.actionType ? { actionType: definition.actionType } : {}),
      ...(definition.traitId ? { traitId: definition.traitId } : {}),
      ...(definition.spellId ? { spellId: definition.spellId } : {}),
      ...(definition.notes ? { notes: definition.notes } : {}),
    };
  });
}

/**
 * Reconcilia o `racialState` com os recursos DERIVADOS depois de uma mudança
 * ESTRUTURAL (troca de raça/sub-raça, Level Up/Down, redução de nível que
 * remova um recurso por `minLevel`):
 *
 * • remove os ids ÓRFÃOS (que a raça atual não concede) e os `obsoleteIds` que o
 *   chamador apontar;
 * • para cada recurso AINDA concedido, clampa `used` ao `max` finito SEM devolver
 *   usos (used 1 com max 1 permanece 1);
 * • chave ausente = 0; zeros não são persistidos;
 * • NUNCA toca em `classState` (o chamador decide o que fazer com ele).
 */
export function reconcileRacialResourceState(
  state: RacialState,
  resources: readonly RacialResource[],
  obsoleteIds: ReadonlySet<string> = new Set(),
): RacialState {
  const byId = new Map(resources.map((resource) => [resource.id, resource]));
  const used: Record<string, number> = {};

  for (const [id, value] of Object.entries(state.used)) {
    if (obsoleteIds.has(id)) continue;
    const resource = byId.get(id);
    // Estado racial ÓRFÃO (recurso que a raça atual não concede) é REMOVIDO.
    if (!resource) continue;
    const clamped = Math.min(value, Math.max(0, resource.max));
    if (clamped > 0) used[id] = clamped;
  }

  return { used };
}

/**
 * Devolve o estado racial com os recursos compatíveis com o descanso
 * restaurados: no CURTO, só os de recarga `short`; no LONGO, os de recarga
 * `short` E `long` (um Descanso Longo também satisfaz o curto). Contadores de
 * recursos que a raça atual NÃO concede ficam intactos — a limpeza de órfãos é
 * responsabilidade da reconciliação na troca de raça.
 */
export function restoreRacialResourcesForRest(
  state: RacialState,
  resources: readonly RacialResource[],
  rest: 'short' | 'long',
): RacialState {
  const used = { ...state.used };
  for (const resource of resources) {
    if (rest === 'long' || resource.recharge === 'short') delete used[resource.id];
  }
  return { used };
}

/**
 * Nomes dos recursos raciais que o descanso vai RESTAURAR (para o resultado
 * estruturado). Só entram os que realmente tinham uso gasto.
 */
export function racialResourcesRestoredByRest(
  state: RacialState,
  resources: readonly RacialResource[],
  rest: 'short' | 'long',
): RacialResource[] {
  return resources.filter(
    (resource) =>
      (rest === 'long' || resource.recharge === 'short') &&
      (state.used[resource.id] ?? 0) > 0,
  );
}

/**
 * Guarda de catálogo: valida a definição de um recurso racial. Devolve a
 * mensagem do problema, ou `null` quando está válida. Nunca corrige em
 * silêncio — um valor inválido é ERRO de programação.
 */
export function invalidRacialResource(definition: RacialResourceDefinition): string | null {
  if (!Number.isInteger(definition.max) || definition.max < 1) {
    return `max inválido em "${definition.id}": ${String(definition.max)} (esperado inteiro >= 1)`;
  }
  if (definition.recharge !== 'short' && definition.recharge !== 'long') {
    return `recharge inválido em "${definition.id}": ${String(definition.recharge)}`;
  }
  return null;
}

/** Todas as definições do catálogo (para os testes varrem a integridade). */
export function allRacialResourceDefinitions(): RacialResourceDefinition[] {
  return Object.values(CATALOG).flatMap((definitions) => [...definitions]);
}

// Referência de tipo para manter `ClassFeatureEffect` no vocabulário do módulo:
// um recurso racial é o irmão do `resource`/`toggle` das features de classe, sem
// reusar `ClassFeatureResource` (que carrega `shared`/`progression` de classe).
export type RacialEffectKind = Extract<ClassFeatureEffect['type'], 'resource'>;
