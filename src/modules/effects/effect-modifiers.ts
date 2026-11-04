import { z } from 'zod';
import { ABILITY_KEYS, ABILITY_LABELS, type AbilityKey } from '../shared/dnd5e.js';
import { conditionSchema, type Condition } from '../shared/conditions.js';
import { SPELL_COMPONENT_LABELS } from '../shared/spells/components.js';

/**
 * FASE 6.5B — MODIFICADORES MECÂNICOS GENÉRICOS de um Effect.
 *
 * O pipeline de rolagem NUNCA conhece nome de magia/feature: ele lê apenas os
 * modificadores tipados abaixo. Quem sabe que "Bless" dá +1d4 em ataques é a
 * futura DEFINIÇÃO do efeito (6.6 Spell Engine), que cria instâncias com estes
 * modificadores — o motor continua cego ao `label`/`definitionId`.
 *
 * União discriminada (e não um objeto cheio de campos opcionais) para o Zod
 * recusar combinações inválidas (ex.: dado sem `sides`, AC com `roll`).
 */

export const EFFECT_ROLL_TYPES = ['attack', 'save', 'check'] as const;
export type EffectRollType = (typeof EFFECT_ROLL_TYPES)[number];

/**
 * Dados que a engine sabe rolar. Conjunto FECHADO de propósito: um modificador
 * de efeito não é uma expressão livre do cliente.
 */
export const EFFECT_MODIFIER_DICE_SIDES = [4, 6, 8, 10, 12, 20, 100] as const;

const abilitySchema = z.enum([...ABILITY_KEYS] as [AbilityKey, ...AbilityKey[]]);
const rollScope = {
  roll: z.enum(EFFECT_ROLL_TYPES),
  /** Restringe o modificador a UM atributo (saves/checks). Ausente = todos. */
  ability: abilitySchema.optional(),
};
const flatValue = z.number().int().min(-100).max(100);

const modifierKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._:-]+$/, { message: 'Chave de modificador inválida.' });

/**
 * Identidade e STACKING de um modificador de rolagem.
 *
 * • `key`: identidade estável DENTRO da instância (fallback: índice). É o que
 *   o cliente devolve ao escolher um modificador OPCIONAL — nunca o label.
 * • `stackingKey`: modificadores com a mesma chave NÃO se somam ("a mesma
 *   magia não acumula"). Vence a fonte mais antiga; quando ela termina, a
 *   seguinte assume automaticamente, sem recriar efeito.
 */
const rollIdentity = {
  key: modifierKeySchema.optional(),
  stackingKey: modifierKeySchema.optional(),
};

/**
 * `optional: true` — o PHB diz "pode" (ex.: Bless). O modificador é OFERECIDO
 * pelo servidor na rolagem e só entra se o ator escolher. Default: obrigatório
 * (todo modificador artificial criado antes da 6.5G continua automático).
 */
const optionalFlag = { optional: z.boolean().optional() };

export const effectModifierSchema = z.discriminatedUnion('kind', [
  /** Bônus fixo (+2) em ataque, salvaguarda ou teste de habilidade. */
  z.object({ kind: z.literal('roll-flat'), ...rollScope, ...rollIdentity, ...optionalFlag, value: flatValue }),
  /** Dado extra rolado pelo SERVIDOR (+1d4, -1d4). */
  z.object({
    kind: z.literal('roll-dice'),
    ...rollScope,
    ...rollIdentity,
    ...optionalFlag,
    count: z.number().int().min(1).max(20),
    sides: z.number().int().refine(
      (sides) => (EFFECT_MODIFIER_DICE_SIDES as readonly number[]).includes(sides),
      { message: 'Dado não suportado pelo motor de efeitos.' },
    ),
    sign: z.union([z.literal(1), z.literal(-1)]),
  }),
  /** Fonte de vantagem (qualquer quantidade = uma fonte; nunca "dupla"). */
  z.object({ kind: z.literal('roll-advantage'), ...rollScope, ...rollIdentity }),
  /** Fonte de desvantagem (idem). */
  z.object({ kind: z.literal('roll-disadvantage'), ...rollScope, ...rollIdentity }),
  /** CA derivada (+1, +2, -1). Nunca grava na ficha. */
  z.object({ kind: z.literal('ac-flat'), value: flatValue }),
  /** Deslocamento derivado em metros (+3, -3). Nunca grava na ficha. */
  z.object({ kind: z.literal('speed-flat'), value: z.number().int().min(-1000).max(1000) }),
  /**
   * BLOQUEIO genérico de componente de conjuração (Fase 6.6G). Não é uma
   * Condition nem conhece a magia: diz apenas que a entidade-alvo não consegue
   * fornecer os componentes listados enquanto o efeito estiver ativo. É o hook
   * que Silêncio (V) e outras restrições futuras vão usar — a magia em si
   * continua fora desta fase.
   */
  z.object({
    kind: z.literal('spell-component-block'),
    components: z
      .array(z.enum(['verbal', 'somatic', 'material']))
      .min(1)
      .max(3),
  }),
]);
export type EffectModifier = z.infer<typeof effectModifierSchema>;

/** Limite duro por instância (validado na borda e na leitura). */
export const MAX_EFFECT_MODIFIERS = 12;
export const effectModifierListSchema = z.array(effectModifierSchema).max(MAX_EFFECT_MODIFIERS);
export type EffectModifierList = z.infer<typeof effectModifierListSchema>;

/**
 * Leitura FECHADA do JSON gravado: qualquer coisa inválida vira lista vazia
 * (um efeito nunca passa a valer mais por dado corrompido).
 */
export function parseEffectModifiers(value: unknown): EffectModifierList {
  const parsed = effectModifierListSchema.safeParse(value ?? []);
  return parsed.success ? parsed.data : [];
}

/**
 * FASE 6.5C — Conditions que ESTE efeito declara aplicar.
 *
 * É DEFINIÇÃO da instância de efeito ("este efeito deve aplicar Paralyzed"),
 * não o estado mecânico real (que vive em `mechanicalState.conditions[]`).
 * Usa o `conditionSchema` EXISTENTE — nenhum enum paralelo de Conditions.
 */
export const MAX_EFFECT_CONDITIONS = 20;
export const effectConditionListSchema = z.array(conditionSchema).max(MAX_EFFECT_CONDITIONS);
export type EffectConditionList = z.infer<typeof effectConditionListSchema>;

/** Leitura FECHADA: JSON inválido nunca vira Condition aplicada. */
export function parseEffectConditions(value: unknown): EffectConditionList {
  const parsed = effectConditionListSchema.safeParse(value ?? []);
  return parsed.success ? parsed.data : [];
}

/** Rótulos PT-BR das Conditions (reexportado para o log do Effect). */
export type EffectCondition = Condition;

/** Origem de um modificador derivado — mantém rastreabilidade até a instância. */
export interface EffectModifierSource {
  effectId: string;
  label: string;
  visibility: 'public' | 'private';
}

/**
 * Rótulo SEGURO para o cliente: efeito privado não entrega nome/identidade
 * (mas o bônus mecânico continua valendo — privacidade não é inatividade).
 */
export function publicEffectLabel(source: EffectModifierSource): string | null {
  return source.visibility === 'private' ? null : source.label;
}

/** Dado extra já rolado (ou a rolar) por uma fonte de efeito. */
export interface EffectDiceModifier {
  count: number;
  sides: number;
  sign: 1 | -1;
  source: EffectModifierSource;
}

/**
 * Modificador OPCIONAL derivado (6.5G): o cliente só devolve o `id` — nunca o
 * valor, o dado nem uma estrutura inventada. O servidor revalida no momento da
 * rolagem (o efeito pode ter terminado entre a renderização e o clique).
 */
export interface EffectOptionalModifier {
  id: string;
  effectId: string;
  roll: EffectRollType;
  ability?: AbilityKey;
  kind: 'roll-dice' | 'roll-flat';
  count?: number;
  sides?: number;
  sign?: 1 | -1;
  value?: number;
  stackingKey: string | null;
  /** Rótulo SEGURO: efeito privado vira "Efeito" (nunca o nome secreto). */
  label: string;
  visibility: 'public' | 'private';
}

/** Forma enviada ao cliente (sem metadados internos). */
export interface EffectOptionalModifierDto {
  id: string;
  roll: EffectRollType;
  ability?: AbilityKey;
  kind: 'roll-dice' | 'roll-flat';
  count?: number;
  sides?: number;
  sign?: 1 | -1;
  value?: number;
  stackingKey: string | null;
  label: string;
}

/** Modificadores de UM tipo de rolagem, normalizados para o pipeline. */
export interface EffectRollModifiers {
  /** Soma dos bônus fixos. */
  bonus: number;
  /** Dados extras — rolados pelo servidor, nunca somados ao bônus fixo. */
  dice: EffectDiceModifier[];
  /** Chaves das fontes de vantagem (para `resolveRollMode`). */
  advantage: string[];
  /** Chaves das fontes de desvantagem. */
  disadvantage: string[];
  /** Fontes que contribuíram (tooltip/log). */
  sources: EffectModifierSource[];
  /** Modificadores que o ator PODE usar nesta rolagem (nunca automáticos). */
  optional: EffectOptionalModifier[];
}

/** Resumo derivado, já sem DB: é o que os pipelines consomem. */
export interface EffectModifierSet {
  attack: EffectRollModifiers;
  saves: Record<AbilityKey, EffectRollModifiers>;
  checks: Record<AbilityKey, EffectRollModifiers>;
  /** Soma dos `ac-flat` ativos. */
  acBonus: number;
  /** Soma dos `speed-flat` ativos (metros). */
  speedBonus: number;
  /** Todas as instâncias que contribuíram (alguma coisa). */
  sources: EffectModifierSource[];
}

export function emptyRollModifiers(): EffectRollModifiers {
  return { bonus: 0, dice: [], advantage: [], disadvantage: [], sources: [], optional: [] };
}

export function emptyEffectModifierSet(): EffectModifierSet {
  const perAbility = () =>
    Object.fromEntries(ABILITY_KEYS.map((ability) => [ability, emptyRollModifiers()])) as Record<
      AbilityKey,
      EffectRollModifiers
    >;
  return {
    attack: emptyRollModifiers(),
    saves: perAbility(),
    checks: perAbility(),
    acBonus: 0,
    speedBonus: 0,
    sources: [],
  };
}

/** Linha mínima de efeito ativo necessária para compor o resumo. */
export interface ActiveEffectRow {
  id: string;
  label: string;
  visibility: string;
  modifiers: unknown;
  /** Desempate DETERMINÍSTICO do stacking (fonte mais antiga vence). */
  createdAt?: string | Date | null;
}

/**
 * Identidade ESTÁVEL de um modificador dentro da instância.
 * Preferência: `modifier.key` declarada pela definição; fallback: o índice no
 * JSON. O cliente nunca escolhe o conteúdo — só devolve este id.
 */
export function effectModifierId(effectId: string, modifier: EffectModifier, index: number): string {
  const key = 'key' in modifier && modifier.key ? modifier.key : String(index);
  return `${effectId}:${key}`;
}

function addSource(target: EffectModifierSource[], source: EffectModifierSource): void {
  if (!target.some((item) => item.effectId === source.effectId)) target.push(source);
}

/**
 * Compõe o resumo de modificadores a partir dos efeitos ATIVOS de um alvo.
 *
 * Regras (Fase 6.5B, sem conteúdo de PHB):
 *  • numéricos STACKAM (dois efeitos +1 e +2 = +3) — a regra "mesma magia não
 *    acumula" pertence à camada de definição/aplicação, não ao motor;
 *  • dados viram pool independente (+1d4 e +1d6 rolam os dois);
 *  • vantagem/desvantagem são CONJUNTOS de fontes: qualquer quantidade vira
 *    uma fonte, e a presença dos dois lados cancela (`resolveRollMode`);
 *  • nada depende da ordem das linhas no banco nem do `label`.
 */
function rowTime(row: ActiveEffectRow): number {
  if (!row.createdAt) return 0;
  const time =
    typeof row.createdAt === 'string' ? Date.parse(row.createdAt) : row.createdAt.getTime();
  return Number.isFinite(time) ? time : 0;
}

export function buildEffectModifierSet(rows: readonly ActiveEffectRow[]): EffectModifierSet {
  const set = emptyEffectModifierSet();
  // Ordem DETERMINÍSTICA: fonte mais antiga primeiro (e o id como desempate).
  // Nada depende da ordem que o banco devolveu.
  const ordered = [...rows].sort((a, b) => rowTime(a) - rowTime(b) || a.id.localeCompare(b.id));
  // Stacking é resolvido POR ALVO de rolagem: dois efeitos ativos com a mesma
  // `stackingKey` produzem UMA contribuição (nunca 2d4 de dois Bless).
  const seenStacking = new Map<EffectRollModifiers, Set<string>>();
  const alreadyStacked = (target: EffectRollModifiers, key: string | null): boolean => {
    if (!key) return false;
    const seen = seenStacking.get(target) ?? new Set<string>();
    if (seen.has(key)) return true;
    seen.add(key);
    seenStacking.set(target, seen);
    return false;
  };

  for (const row of ordered) {
    const source: EffectModifierSource = {
      effectId: row.id,
      label: row.label,
      visibility: row.visibility === 'private' ? 'private' : 'public',
    };
    const modifiers = parseEffectModifiers(row.modifiers);
    let contributed = false;
    modifiers.forEach((modifier, index) => {
      // Bloqueio de componente (6.6G) não entra em bônus de rolagem/CA/deslocamento:
      // quem o consome é o resolvedor de componentes da conjuração.
      if (modifier.kind === 'spell-component-block') return;
      if (modifier.kind === 'ac-flat') {
        set.acBonus += modifier.value;
        contributed = true;
        addSource(set.sources, source);
        return;
      }
      if (modifier.kind === 'speed-flat') {
        set.speedBonus += modifier.value;
        contributed = true;
        addSource(set.sources, source);
        return;
      }
      // Modificador de rolagem: entra no escopo declarado e, se houver
      // `ability`, SÓ naquele atributo (saves e checks).
      const targets: EffectRollModifiers[] = [
        ...(modifier.roll === 'attack' ? [set.attack] : []),
        ...(modifier.roll === 'save' ? abilityTargets(set.saves, modifier.ability) : []),
        ...(modifier.roll === 'check' ? abilityTargets(set.checks, modifier.ability) : []),
      ];
      const id = effectModifierId(row.id, modifier, index);
      const stackingKey = modifier.stackingKey ?? null;
      let applied = false;
      for (const target of targets) {
        if (alreadyStacked(target, stackingKey)) continue;
        applyRollModifier(target, modifier, source, id);
        applied = true;
      }
      if (applied) {
        contributed = true;
        // Fonte de modificador OPCIONAL não entra em `sources` até ser usada:
        // o breakdown só lista o que realmente foi aplicado.
        if (!('optional' in modifier && modifier.optional)) addSource(set.sources, source);
      }
    });
  }
  return set;
}

/**
 * Valida a escolha do cliente contra as opções REALMENTE oferecidas pelo
 * servidor para esta rolagem. Ids inválidos são rejeitados (nunca ignorados em
 * silêncio): efeito encerrado, outro ator, outro escopo ou payload inventado.
 */
export function selectOptionalModifiers(
  mods: EffectRollModifiers,
  selected: readonly string[] | undefined,
): { options: EffectOptionalModifier[]; invalid: string[] } {
  if (!selected || selected.length === 0) return { options: [], invalid: [] };
  const byId = new Map(mods.optional.map((option) => [option.id, option]));
  const options: EffectOptionalModifier[] = [];
  const invalid: string[] = [];
  for (const id of new Set(selected)) {
    const option = byId.get(id);
    if (option) options.push(option);
    else invalid.push(id);
  }
  return { options, invalid };
}

/** DTO seguro para o cliente (sem effectId/metadados internos). */
export function toOptionalModifierDtos(
  options: readonly EffectOptionalModifier[],
): EffectOptionalModifierDto[] {
  return options.map((option) => ({
    id: option.id,
    roll: option.roll,
    ...(option.ability ? { ability: option.ability } : {}),
    kind: option.kind,
    ...(option.count !== undefined ? { count: option.count } : {}),
    ...(option.sides !== undefined ? { sides: option.sides } : {}),
    ...(option.sign !== undefined ? { sign: option.sign } : {}),
    ...(option.value !== undefined ? { value: option.value } : {}),
    stackingKey: option.stackingKey,
    label: option.label,
  }));
}

function abilityTargets(
  map: Record<AbilityKey, EffectRollModifiers>,
  ability: AbilityKey | undefined,
): EffectRollModifiers[] {
  return ability ? [map[ability]] : ABILITY_KEYS.map((key) => map[key]);
}

function applyRollModifier(
  target: EffectRollModifiers,
  modifier: EffectModifier,
  source: EffectModifierSource,
  id: string,
): void {
  if (modifier.kind === 'roll-flat') {
    if (modifier.optional) {
      target.optional.push({
        id,
        effectId: source.effectId,
        roll: modifier.roll,
        ...(modifier.ability ? { ability: modifier.ability } : {}),
        kind: 'roll-flat',
        value: modifier.value,
        stackingKey: modifier.stackingKey ?? null,
        label: publicEffectLabel(source) ?? 'Efeito',
        visibility: source.visibility,
      });
      return;
    }
    target.bonus += modifier.value;
    addSource(target.sources, source);
    return;
  }
  if (modifier.kind === 'roll-dice') {
    if (modifier.optional) {
      target.optional.push({
        id,
        effectId: source.effectId,
        roll: modifier.roll,
        ...(modifier.ability ? { ability: modifier.ability } : {}),
        kind: 'roll-dice',
        count: modifier.count,
        sides: modifier.sides,
        sign: modifier.sign,
        stackingKey: modifier.stackingKey ?? null,
        label: publicEffectLabel(source) ?? 'Efeito',
        visibility: source.visibility,
      });
      return;
    }
    target.dice.push({
      count: modifier.count,
      sides: modifier.sides,
      sign: modifier.sign,
      source,
    });
    addSource(target.sources, source);
    return;
  }
  if (modifier.kind === 'roll-advantage') {
    target.advantage.push(`effect:${source.effectId}:advantage`);
    addSource(target.sources, source);
    return;
  }
  if (modifier.kind === 'roll-disadvantage') {
    target.disadvantage.push(`effect:${source.effectId}:disadvantage`);
    addSource(target.sources, source);
  }
}

/** Seleciona o resumo de UMA rolagem (attack, ou save/check de um atributo). */
export function rollModifiersFor(
  set: EffectModifierSet,
  roll: EffectRollType,
  ability?: AbilityKey,
): EffectRollModifiers {
  if (roll === 'attack') return set.attack;
  const map = roll === 'save' ? set.saves : set.checks;
  return ability ? map[ability] : emptyRollModifiers();
}

/**
 * Rótulos das fontes para exibição: público mostra o nome; privado mostra
 * `null` (o bônus continua valendo, mas o segredo não vaza).
 */
export function effectSourceLabels(set: EffectModifierSet): (string | null)[] {
  return set.sources.map(publicEffectLabel);
}

/** Rótulos seguros das fontes que contribuíram para UMA rolagem. */
export function rollModifierSourceLabels(mods: EffectRollModifiers): (string | null)[] {
  return mods.sources.map(publicEffectLabel);
}

/** Peças de CA derivadas dos efeitos (para `computeArmorClass`). */
export function effectArmorClassBonuses(
  set: EffectModifierSet,
): { label: string | null; value: number }[] {
  if (set.acBonus === 0) return [];
  const labels = effectSourceLabels(set).filter((label): label is string => label !== null);
  return [{ label: labels.length > 0 ? labels.join(', ') : null, value: set.acBonus }];
}

/** Texto humano de um modificador (para a UI do Mestre e o log). */
export function describeEffectModifier(modifier: EffectModifier): string {
  if (modifier.kind === 'spell-component-block') {
    return `Bloqueia ${modifier.components
      .map((component) => SPELL_COMPONENT_LABELS[component])
      .join(', ')}`;
  }
  const scope =
    modifier.kind === 'ac-flat' || modifier.kind === 'speed-flat'
      ? ''
      : `${ROLL_TYPE_LABELS[modifier.roll]}${modifier.ability ? ` (${ABILITY_LABELS[modifier.ability]})` : ''}`;
  if (modifier.kind === 'ac-flat') return `CA ${modifier.value >= 0 ? '+' : ''}${modifier.value}`;
  if (modifier.kind === 'speed-flat') {
    return `Deslocamento ${modifier.value >= 0 ? '+' : ''}${modifier.value} m`;
  }
  const optional = 'optional' in modifier && modifier.optional ? ' (opcional)' : '';
  if (modifier.kind === 'roll-flat') {
    return `${modifier.value >= 0 ? '+' : ''}${modifier.value} em ${scope}${optional}`;
  }
  if (modifier.kind === 'roll-dice') {
    return `${modifier.sign > 0 ? '+' : '−'}${modifier.count}d${modifier.sides} em ${scope}${optional}`;
  }
  if (modifier.kind === 'roll-advantage') return `Vantagem em ${scope}`;
  return `Desvantagem em ${scope}`;
}

export const ROLL_TYPE_LABELS: Record<EffectRollType, string> = {
  attack: 'ataques',
  save: 'salvaguardas',
  check: 'testes de habilidade',
};

