import { availableAttacks, requiredAmmoType, weaponOf } from '../ammo';
import { WEAPON_TYPE_LABELS, damageExpression, formatModifier } from '../dnd';
import type { Attack, InventoryItem } from '../types';

/**
 * HOTBAR DE COMBATE — PROTÓTIPO (6.6M.6).
 *
 * Este arquivo é um ADAPTER DE APRESENTAÇÃO e nada mais. Ele não descobre ação
 * nenhuma: recebe o MESMO array que o `CombatActionPanel` recebe e aplica o
 * MESMO filtro de arma equipada (`availableAttacks`). Não rola dado, não cobra
 * Ação, não escolhe alvo, não compara alcance e não decide se a ação vale — isso
 * continua inteiro no servidor. Existe para provar a UX antes da Hotbar final.
 */

/** Slots visíveis do protótipo. Mais que isso fica no "ver todas". */
export const HOTBAR_SLOTS = 8;

/**
 * Ordem determinística das categorias. Nada de algoritmo de relevância nesta
 * fase: a ordem DENTRO de cada categoria é a da fonte (sort estável).
 */
const KIND_ORDER = ['attack', 'feature', 'spell', 'item'] as const;
export type HotbarKind = (typeof KIND_ORDER)[number];

/**
 * Custo TÍPICO da opção, quando o próprio sistema já o conhece. É indicação
 * visual (A/B/R) — nunca autorização: quem cobra Ação/Bônus/Reação é o servidor.
 */
export type HotbarCost = 'action' | 'bonus-action' | 'reaction' | 'other';

export interface CombatHotbarEntry {
  /** Identidade do slot: categoria + id de origem (dedupe e marcação). */
  id: string;
  kind: HotbarKind;
  label: string;
  /** Linha curta com dados JÁ derivados pelo sistema (bônus, dano, alcance). */
  detail: string;
  /** Texto que já existe na fonte; nada é copiado do PHB para preencher tooltip. */
  description?: string;
  icon: 'sword' | 'ammo';
  cost: HotbarCost;
  /** Id no fluxo EXISTENTE: o clique só encaminha para ele. */
  sourceId: string;
}

/** Alcance legível da arma vinculada (mesma leitura dos cartões de ataque). */
function attackRange(weapon: InventoryItem | null): string | null {
  const normal = weapon?.details.rangeNormal;
  if (!normal) return null;
  const long = weapon?.details.rangeLong;
  return long ? `${normal}/${long} m` : `${normal} m`;
}

/**
 * Entradas da Hotbar a partir dos ataques já derivados pela ficha.
 *
 * Fontes desta fase (só o que tem contrato real):
 * - ataques: `characterAttacks` (o mesmo array do painel) filtrado por
 *   `availableAttacks` (arma vinculada precisa estar equipada);
 * - features/spells/items: NENHUMA. Não há fluxo executável de feature nesta
 *   fase e a conjuração por jogador (6.6F) ainda não existe — inventar slots
 *   "disponíveis" seria prometer mecânica que o servidor recusa.
 */
export function buildCombatHotbarEntries({
  attacks,
  inventory,
}: {
  attacks: readonly Attack[];
  /** Sem inventário não há como avaliar arma equipada/munição: usa a lista crua. */
  inventory?: readonly InventoryItem[];
}): CombatHotbarEntry[] {
  const usable = inventory ? availableAttacks(attacks, inventory) : [...attacks];
  const seen = new Set<string>();
  const entries: CombatHotbarEntry[] = [];

  for (const attack of usable) {
    if (!attack.id || seen.has(attack.id)) continue;
    seen.add(attack.id);

    const weapon = inventory ? weaponOf(attack, inventory) : null;
    const range = attackRange(weapon);
    const ammo = requiredAmmoType(weapon);
    const type = weapon?.details.weaponType
      ? WEAPON_TYPE_LABELS[weapon.details.weaponType]
      : attack.ranged
        ? WEAPON_TYPE_LABELS.ranged
        : WEAPON_TYPE_LABELS.melee;
    const damage = [attack.damage, ...(attack.extraDamages ?? [])]
      .map((item) => `${damageExpression(item)}${item.type ? ` ${item.type}` : ''}`)
      .join(' + ');

    entries.push({
      id: `attack:${attack.id}`,
      kind: 'attack',
      label: attack.name,
      detail: [
        type,
        `${formatModifier(attack.attackBonus)} para acertar`,
        damage,
        range ? `alcance ${range}` : null,
        ammo ? `munição ${ammo}` : null,
      ]
        .filter((part): part is string => part !== null)
        .join(' · '),
      icon: attack.ranged ? 'ammo' : 'sword',
      // O ataque da mão secundária já é conhecido pelo fluxo como Ação Bônus
      // (mesma convenção de id usada pelo painel); o resto é Ação.
      cost: attack.id.startsWith('offhand:') ? 'bonus-action' : 'action',
      sourceId: attack.id,
    });
  }

  return entries.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

/**
 * FILTRO DE NAVEGAÇÃO DA HOTBAR (6.6M.6.2).
 *
 * Os três glifos da dock (Ação ◆, Ação Bônus ⬢, Reação ★) filtram a Hotbar pelo
 * CUSTO TÍPICO da entrada. É navegação — não gasta, não reserva, não autoriza e
 * não altera recurso nenhum: quem cobra e valida continua sendo o servidor.
 *
 * `other` NÃO tem filtro de propósito: sem contrato real de classificação, a
 * entrada permanece apenas na visão completa (nunca é jogada numa das três).
 */
export type HotbarFilter = 'action' | 'bonus-action' | 'reaction';

/** Nome do filtro para o estado vazio e para o rótulo acessível do glifo. */
export function hotbarFilterLabel(filter: HotbarFilter): string {
  if (filter === 'action') return 'Ação';
  if (filter === 'bonus-action') return 'Ação Bônus';
  return 'Reação';
}

/**
 * Recorte da Hotbar pelo filtro escolhido. Sem filtro devolve a listagem
 * completa (inclusive `other`); com filtro, só o custo pedido. Como o filtro é
 * igualdade de `cost`, `other` nunca é classificado silenciosamente.
 */
export function filterHotbarEntries(
  entries: readonly CombatHotbarEntry[],
  filter: HotbarFilter | null,
): CombatHotbarEntry[] {
  if (!filter) return [...entries];
  return entries.filter((entry) => entry.cost === filter);
}
