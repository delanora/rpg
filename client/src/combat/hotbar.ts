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

/**
 * GRADE DA HOTBAR (6.6M.6.3): 48 posições INDEXADAS em 2 linhas de 24.
 *
 * A Hotbar deixou de ser "até 8 slots fixos": a grade é explícita (colunas ×
 * linhas) e cada posição tem índice 1-based, para a personalização de slots
 * apenas REMANEJAR entradas sobre uma grade que já existe. O que passa de 48
 * continua na lista "ver todas" (nada é escondido sem aviso).
 *
 * 24 colunas × 2 linhas é o número que deixa o slot PRÓXIMO DO QUADRADO no
 * bloco central da dock: a largura de cada coluna (largura útil ÷ 24) fica na
 * mesma ordem da altura da linha (altura da faixa ÷ 2). Com 16 colunas sobrava
 * largura e o slot virava um retângulo deitado.
 */
export const HOTBAR_COLUMNS = 24;
export const HOTBAR_ROWS = 2;
export const HOTBAR_SLOTS = HOTBAR_COLUMNS * HOTBAR_ROWS;

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

/**
 * Uma posição da grade: `entry` preenchida ou `null` (slot vazio reservado).
 *
 * Distinguir "preenchido" de "vazio" é ESTRUTURA, não estilo: a futura
 * personalização guarda o `sourceId` de cada índice e o vazio é a ausência de
 * entrada — nunca um placeholder fictício.
 */
export interface HotbarSlot {
  /** Posição na grade, 1-based (o número desenhado no slot). */
  index: number;
  entry: CombatHotbarEntry | null;
}

/**
 * Abre as entradas na grade fixa de 48 posições (ordem preservada).
 *
 * Função PURA de apresentação: não consulta recurso, turno, alvo nem servidor —
 * só distribui o que o chamador já filtrou. As sobras viram `null` (slots
 * vazios) e o excedente fica fora da grade ("ver todas").
 */
export function buildHotbarSlots(entries: readonly CombatHotbarEntry[]): HotbarSlot[] {
  return Array.from({ length: HOTBAR_SLOTS }, (_, offset) => ({
    index: offset + 1,
    entry: entries[offset] ?? null,
  }));
}

/**
 * Clique no slot é TOGGLE (6.6M.6.2.2).
 *
 * O MESMO botão que abre a pré-seleção a fecha: clicar na entrada já escolhida
 * devolve `null` (o painel tático desmonta e o destaque sai) e clicar em outra
 * troca a seleção, avançando o `nonce` para o painel reiniciar do zero. A
 * identidade é a do FLUXO (`sourceId`, inclusive `offhand:`), nunca o índice do
 * slot nem o nome. Puro e sem rede: desmarcar não envia nada ao servidor nem
 * consome Ação, Ação Bônus ou Reação.
 */
export function toggleHotbarPick(
  previous: { attackId: string; nonce: number } | null,
  sourceId: string,
): { attackId: string; nonce: number } | null {
  if (previous?.attackId === sourceId) return null;
  return { attackId: sourceId, nonce: (previous?.nonce ?? 0) + 1 };
}

/**
 * A SELEÇÃO continua na lista visível com este filtro? (6.6M.6.2.1)
 *
 * A pré-seleção da Hotbar aponta para uma ENTRADA, e a entrada pode não
 * pertencer ao recorte novo: trocar de Ação para Ação Bônus não pode deixar o
 * painel tático com um ataque de outro custo "preso". Sem entrada escolhida a
 * resposta é `true` (não há nada a descartar) e ampliar o filtro nunca invalida
 * nada — só o recorte menor pode. Puro: não olha recurso, turno nem servidor.
 */
export function selectionSurvivesFilter(
  entries: readonly CombatHotbarEntry[],
  filter: HotbarFilter | null,
  sourceId: string | null | undefined,
): boolean {
  if (!sourceId) return true;
  return filterHotbarEntries(entries, filter).some((entry) => entry.sourceId === sourceId);
}

/* ------------------------------------------------------------------------- */
/* PERSONALIZAÇÃO DOS 48 SLOTS (6.6M.6.3.1)                                   */
/* ------------------------------------------------------------------------- */

/**
 * Referência PERSISTIDA de uma posição (mesmo formato do DTO do servidor).
 * Só a identidade da ação: rótulo, custo, bônus e dano continuam derivados da
 * fonte real a cada leitura — nada disso é salvo na Hotbar.
 */
export interface HotbarSlotRef {
  kind: 'attack';
  sourceId: string;
}

/** Configuração salva (48 posições). `null` = nunca personalizada. */
export type HotbarLayout = readonly (HotbarSlotRef | null)[];

/**
 * Estado de uma posição na grade:
 * - `empty`: não há atalho (vazia de propósito, quando há layout salvo);
 * - `ready`: a atalho existe e está utilizável agora;
 * - `unavailable`: o atalho existe na ficha, mas está temporariamente
 *   indisponível (ex.: arma desequipada) — a POSIÇÃO é preservada;
 * - `missing`: a referência aponta para algo que não existe mais (ataque
 *   removido) — só pode ser removida ou substituída, nunca executada.
 */
export type HotbarSlotState = 'empty' | 'ready' | 'unavailable' | 'missing';

export interface HotbarSlotView {
  index: number;
  entry: CombatHotbarEntry | null;
  ref: HotbarSlotRef | null;
  state: HotbarSlotState;
  /** Nome conhecido quando não há `entry` (indisponível/ausente). */
  label?: string;
  /**
   * FORA da categoria filtrada: continua DESENHADO na grade (esmaecido e sem
   * clique), só que depois dos atalhos da categoria escolhida. Máscara é
   * visualização, nunca escrita — a configuração salva não muda.
   */
  masked?: boolean;
}

/** Configuração vazia (48 posições nulas) — usada só no modo de edição. */
export function emptyHotbarLayout(): (HotbarSlotRef | null)[] {
  return Array.from({ length: HOTBAR_SLOTS }, () => null);
}

/**
 * Grade de 48 posições resolvida contra a ficha atual.
 *
 * SEM layout salvo (`null`) o preenchimento automático continua igual ao de
 * sempre: os ataques disponíveis ocupam as primeiras posições e o resto é vazio
 * — é o ponto de partida da PRIMEIRA personalização.
 *
 * COM layout salvo a configuração manda: cada índice recebe a referência dele e
 * nada é remanejado. Atalho cuja arma foi desequipada continua na posição como
 * `unavailable`, e referência que não existe mais vira `missing` — em nenhum dos
 * dois casos o slot é executado por confiar no que está salvo.
 */
export function resolveHotbarSlots({
  entries,
  attacks,
  layout,
}: {
  /** Entradas DISPONÍVEIS agora (mesma lista do painel de ataque). */
  entries: readonly CombatHotbarEntry[];
  /** Todos os ataques da ficha (inclui o que está fora de alcance de equipar). */
  attacks: readonly Attack[];
  layout: HotbarLayout | null;
}): HotbarSlotView[] {
  if (!layout) {
    return Array.from({ length: HOTBAR_SLOTS }, (_, offset) => {
      const entry = entries[offset] ?? null;
      return {
        index: offset + 1,
        entry,
        ref: entry ? { kind: 'attack' as const, sourceId: entry.sourceId } : null,
        state: entry ? ('ready' as const) : ('empty' as const),
      };
    });
  }

  const bySource = new Map(entries.map((entry) => [entry.sourceId, entry]));
  const attackNames = new Map(attacks.map((attack) => [attack.id, attack.name]));

  return Array.from({ length: HOTBAR_SLOTS }, (_, offset) => {
    const ref = layout[offset] ?? null;
    if (!ref) return { index: offset + 1, entry: null, ref: null, state: 'empty' as const };

    const entry = bySource.get(ref.sourceId) ?? null;
    if (entry) return { index: offset + 1, entry, ref, state: 'ready' as const };

    const name = attackNames.get(ref.sourceId);
    if (name) {
      return { index: offset + 1, entry: null, ref, state: 'unavailable' as const, label: name };
    }
    return { index: offset + 1, entry: null, ref, state: 'missing' as const };
  });
}

/**
 * FILTRO A/B/R NA GRADE (6.6M.6.3.1.1) — a grade NUNCA encolhe.
 *
 * A categoria escolhida vem para o INÍCIO da grade, na ordem em que já estava,
 * e os demais atalhos continuam desenhados logo depois — esmaecidos e sem
 * clique, mas VISÍVEIS. Nada some da Hotbar, nada é apagado e nada é salvo: o
 * filtro é navegação, então a configuração persistida não muda de posição.
 *
 * Slots vazios completam o resto da grade, que segue com as 48 posições.
 */
export function filterHotbarView(
  slots: readonly HotbarSlotView[],
  filter: HotbarFilter | null,
): HotbarSlotView[] {
  if (!filter) return slots.map((slot) => ({ ...slot, masked: false }));

  const matched: HotbarSlotView[] = [];
  const others: HotbarSlotView[] = [];
  const empty: HotbarSlotView[] = [];

  for (const slot of slots) {
    if (slot.entry) (slot.entry.cost === filter ? matched : others).push(slot);
    else empty.push(slot);
  }

  // O índice devolvido é a POSIÇÃO DESENHADA da grade (1-based). A referência
  // salva (`ref`) viaja junto: a configuração nunca é reescrita pelo filtro.
  return [...matched, ...others, ...empty].map((slot, offset) => ({
    ...slot,
    index: offset + 1,
    masked: Boolean(slot.entry && slot.entry.cost !== filter),
  }));
}

/** Configuração (48 refs) a partir de uma grade resolvida. */
export function layoutOfSlots(slots: readonly HotbarSlotView[]): (HotbarSlotRef | null)[] {
  return slots.map((slot) => slot.ref ?? null);
}

/**
 * Atribui um atalho a um slot. REGRA DA FASE: uma posição por identidade — se o
 * atalho já estava em outro slot, ele SAI de lá (mover, não duplicar); se o
 * destino estava ocupado, os dois trocam de lugar. Puro: não salva nada.
 */
export function assignHotbarRef(
  layout: HotbarLayout,
  index: number,
  ref: HotbarSlotRef,
): (HotbarSlotRef | null)[] {
  const next = Array.from({ length: HOTBAR_SLOTS }, (_, i) => layout[i] ?? null);
  const from = next.findIndex((item) => item && item.kind === ref.kind && item.sourceId === ref.sourceId);
  const previous = next[index] ?? null;
  if (from >= 0) next[from] = previous;
  next[index] = { kind: ref.kind, sourceId: ref.sourceId };
  return next;
}

/** Move/troca: destino ocupado recebe o atalho e o origem recebe o que estava lá. */
export function moveHotbarRef(
  layout: HotbarLayout,
  from: number,
  to: number,
): (HotbarSlotRef | null)[] {
  const next = Array.from({ length: HOTBAR_SLOTS }, (_, i) => layout[i] ?? null);
  if (from === to || from < 0 || to < 0 || from >= HOTBAR_SLOTS || to >= HOTBAR_SLOTS) return next;
  const moving = next[from] ?? null;
  next[from] = next[to] ?? null;
  next[to] = moving;
  return next;
}

/** Esvazia uma posição (o ataque e o item continuam na ficha). */
export function clearHotbarRef(
  layout: HotbarLayout,
  index: number,
): (HotbarSlotRef | null)[] {
  const next = Array.from({ length: HOTBAR_SLOTS }, (_, i) => layout[i] ?? null);
  next[index] = null;
  return next;
}

/** Duas configurações são iguais posição a posição (habilita Salvar). */
export function sameHotbarLayout(a: HotbarLayout | null, b: HotbarLayout | null): boolean {
  if (!a || !b) return a === b;
  for (let index = 0; index < HOTBAR_SLOTS; index += 1) {
    const left = a[index] ?? null;
    const right = b[index] ?? null;
    if ((left?.sourceId ?? null) !== (right?.sourceId ?? null)) return false;
    if ((left?.kind ?? null) !== (right?.kind ?? null)) return false;
  }
  return true;
}

/** Entradas disponíveis que NÃO estão na grade (vão para o "ver todas"). */
export function entriesOutsideLayout(
  entries: readonly CombatHotbarEntry[],
  layout: HotbarLayout | null,
): CombatHotbarEntry[] {
  if (!layout) return [];
  const placed = new Set(
    layout
      .filter((ref): ref is HotbarSlotRef => Boolean(ref))
      .map((ref) => ref.sourceId),
  );
  return entries.filter((entry) => !placed.has(entry.sourceId));
}
