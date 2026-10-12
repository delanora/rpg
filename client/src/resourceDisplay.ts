import type { Character, RacialResource } from './types';

/**
 * View-model de APRESENTAÇÃO dos recursos do personagem (5.3E.2).
 *
 * A ideia da fase é visual: unificar CLASSE e RAÇA numa só área, sem misturar a
 * fonte de verdade. Este módulo só COMPÕE o que o servidor já deriva
 * (`classAdjustments.resources` + `racialAdjustments.resources`) — nunca altera
 * mecânica, nunca converte os dois arrays num só estado persistido. A separação
 * estrutural continua sendo de cada origem; o que se unifica é a LEITURA.
 *
 * Regras de apresentação (decisões de projeto):
 * • origem sempre explícita (Classe / Raça);
 * • a informação principal é `remaining / max` — `used` nunca aparece;
 * • a recarga vira texto humano (Descanso Curto / Descanso Longo / Sem recarga);
 * • recurso em 0 continua visível;
 * • id técnico nunca é exibido;
 * • só se mostra botão quando existe uma AÇÃO real (magias raciais ficam na aba
 *   Magias e não ganham botão aqui, para não duplicar).
 */

/** Origem de um recurso exibido. */
export type ResourceOrigin = 'class' | 'race';

/** Ação real associada ao recurso (quando existe). */
export interface ResourceAction {
  kind: 'racial-use';
  /** Texto do botão (ex.: 'Usar Sopro', 'Marcar uso'). */
  label: string;
}

/** Um recurso pronto para exibição. */
export interface DisplayedResource {
  /** Id técnico — usado só como `key`/para disparar a ação, nunca exibido. */
  id: string;
  name: string;
  origin: ResourceOrigin;
  /** Rótulo humano da origem específica (ex.: 'Bárbaro' ou 'Classe'; 'Draconato'). */
  originLabel: string;
  max: number;
  remaining: number;
  unlimited: boolean;
  /** Recarga em linguagem humana ('' quando ilimitado). */
  rechargeLabel: string;
  /** Ação real associada; `null` quando não há botão. */
  action: ResourceAction | null;
  /** Descrição curta (tooltip), quando houver. */
  notes?: string;
}

/** Um grupo visual de recursos (por origem). Grupos vazios são OMITIDOS. */
export interface ResourceGroup {
  origin: ResourceOrigin;
  /** Título curto do grupo: 'Classe' / 'Raça'. */
  label: string;
  resources: DisplayedResource[];
}

/** Texto humano da recarga. `none` = sem recarga automática (especial). */
export function rechargeLabel(recharge: 'short' | 'long' | 'none'): string {
  switch (recharge) {
    case 'short':
      // O Descanso Longo também cobre a recarga curta, mas o rótulo curto já
      // informa o suficiente (padrão único da fase).
      return 'Descanso Curto';
    case 'long':
      return 'Descanso Longo';
    default:
      return 'Sem recarga automática';
  }
}

/**
 * Mapa `id do recurso de classe → nomes das classes que o concedem`.
 *
 * A origem vem dos DADOS do catálogo já presentes no DTO (`activeFeatures`, cujo
 * efeito `resource` declara o próprio id), e não de uma tabela fixa por id — o
 * que a fase proíbe. Um recurso COMPARTILHADO no multiclasse (ex.: Canalizar
 * Divindade) é declarado por mais de uma classe e por isso acumula os nomes
 * ('Clérigo + Paladino'). Sem dado suficiente, cai em 'Classe'.
 */
function classNamesByResource(character: Character): Map<string, string[]> {
  const classNameByKey = new Map(character.classes.map((entry) => [entry.classKey, entry.className]));
  const byId = new Map<string, string[]>();

  for (const feature of character.activeFeatures) {
    const className = feature.classKey ? classNameByKey.get(feature.classKey) : undefined;
    if (!className) continue;
    const effects = feature.effects ?? (feature.effect ? [feature.effect] : []);
    for (const effect of effects) {
      if (effect.type !== 'resource') continue;
      const id = effect.id ?? feature.id;
      if (!id) continue;
      const names = byId.get(id) ?? [];
      if (!names.includes(className)) names.push(className);
      byId.set(id, names);
    }
  }
  return byId;
}

/** Ação de um recurso racial: magias ficam na aba Magias (sem botão aqui). */
function racialAction(resource: RacialResource): ResourceAction | null {
  if (resource.spellId) return null;
  if (!resource.actionLabel) return null;
  return { kind: 'racial-use', label: resource.actionLabel };
}

/** Constrói os recursos de CLASSE para exibição (origem por classe que os dá). */
function buildClassResources(character: Character): DisplayedResource[] {
  const namesByResource = classNamesByResource(character);
  return character.classAdjustments.resources.map((resource) => ({
    id: resource.id,
    name: resource.name,
    origin: 'class' as const,
    originLabel: (namesByResource.get(resource.id) ?? []).join(' + ') || 'Classe',
    max: resource.max,
    remaining: resource.remaining,
    unlimited: resource.unlimited,
    rechargeLabel: resource.unlimited ? '' : rechargeLabel(resource.recharge),
    action: null,
  }));
}

/** Constrói os recursos RACIAIS para exibição (origem = a raça do personagem). */
function buildRaceResources(character: Character): DisplayedResource[] {
  return character.racialAdjustments.resources.map((resource) => ({
    id: resource.id,
    name: resource.name,
    origin: 'race' as const,
    originLabel: character.race.trim() || 'Raça',
    max: resource.max,
    remaining: resource.remaining,
    unlimited: false,
    rechargeLabel: rechargeLabel(resource.recharge),
    action: racialAction(resource),
    notes: resource.notes,
  }));
}

/**
 * Grupos de recursos do personagem, na ordem estável do catálogo (Classe antes
 * de Raça). Devolve `[]` quando o personagem não tem recurso limitado — a área
 * some por completo (empty state discreto no chamador, se necessário).
 */
export function buildResourceGroups(character: Character): ResourceGroup[] {
  const groups: ResourceGroup[] = [];
  const classResources = buildClassResources(character);
  if (classResources.length > 0) {
    groups.push({ origin: 'class', label: 'Classe', resources: classResources });
  }
  const raceResources = buildRaceResources(character);
  if (raceResources.length > 0) {
    groups.push({ origin: 'race', label: 'Raça', resources: raceResources });
  }
  return groups;
}
