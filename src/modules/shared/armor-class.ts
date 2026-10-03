import type { ArmorType, ItemDetails } from './item-details.js';

/**
 * Classe de Armadura calculada (PHB 2014).
 *
 * A CA **nunca** é um valor fixo da ficha: ela sai dos atributos atuais e do
 * equipamento. O único valor gravado é o override manual do mestre (`0` =
 * automático). Fica em `shared` porque a ficha (DTO) e o combate usam a mesma
 * conta.
 */

/** Armadura equipada (o item de categoria Armadura no slot de peitoral). */
export interface ArmorPiece {
  name: string;
  type: ArmorType;
  /** CA base da armadura (ex.: couro = 11, cota de malha = 16). */
  base: number;
}

/** Escudo equipado (o item de categoria Escudo). */
export interface ShieldPiece {
  name: string;
}

/** Tudo que o equipamento contribui para a CA. */
export interface ArmorClassPieces {
  armor: ArmorPiece | null;
  /** Escudo equipado (o PRIMEIRO encontrado), para exibir e aferir proficiência. */
  shield: ShieldPiece | null;
  /** Soma do bônus de CA dos escudos equipados. */
  shieldBonus: number;
  /** Bônus mágicos de itens equipados que não são a armadura (nem o escudo). */
  magicBonus: number;
}

/**
 * Textos das proficiências de armadura (PHB 2014), como aparecem em
 * `CLASS_PROFICIENCIES` e no JSONB `characters.proficiencies.armor`.
 */
export const ARMOR_PROFICIENCY_LIGHT = 'Armaduras leves';
export const ARMOR_PROFICIENCY_MEDIUM = 'Armaduras médias';
export const ARMOR_PROFICIENCY_HEAVY = 'Armaduras pesadas';
export const ARMOR_PROFICIENCY_SHIELD = 'Escudos';

const ARMOR_PROFICIENCY_BY_TYPE: Record<ArmorType, string> = {
  Leve: ARMOR_PROFICIENCY_LIGHT,
  Média: ARMOR_PROFICIENCY_MEDIUM,
  Pesada: ARMOR_PROFICIENCY_HEAVY,
};

/**
 * Estado de proficiência do equipamento defensivo equipado.
 *
 * `true` = o personagem DOMINA aquele item (ou NÃO há item daquele tipo
 * equipado, quando não há penalidade a aplicar). `false` = veste armadura/escudo
 * sem proficiência — é o gatilho das penalidades de não proficiência do PHB
 * (que a Fase 8 vai consumir: desvantagem em testes/salvaguardas/ataques de
 * FOR/DES e impossibilidade de conjurar).
 */
export interface ArmorProficiencyState {
  armor: boolean;
  shield: boolean;
}

/** A lista de proficiências inclui este TIPO de armadura? (comparação exata) */
export function isArmorTypeProficient(
  proficiencies: readonly string[],
  type: ArmorType,
): boolean {
  const required = ARMOR_PROFICIENCY_BY_TYPE[type];
  return proficiencies.some(
    (entry) => entry.trim().toLowerCase() === required.toLowerCase(),
  );
}

/**
 * A lista inclui proficiência com ESCUDOS? Aceita variantes do livro (ex.:
 * "Escudos (não usa metal)" do Druida) por prefixo.
 */
export function isShieldProficient(proficiencies: readonly string[]): boolean {
  return proficiencies.some((entry) => entry.trim().toLowerCase().startsWith('escudos'));
}

/**
 * Resolve a proficiência do que está EQUIPADO (armadura por TIPO e escudo).
 * Sem armadura/escudo equipado, o campo correspondente é `true` (nada a
 * penalizar) — a CA automática nunca muda por causa disto.
 */
export function armorProficiencyOf(
  proficiencies: readonly string[],
  pieces: ArmorClassPieces,
): ArmorProficiencyState {
  return {
    armor: pieces.armor === null ? true : isArmorTypeProficient(proficiencies, pieces.armor.type),
    shield: pieces.shield === null ? true : isShieldProficient(proficiencies),
  };
}

/** Fórmula de defesa sem armadura concedida por uma classe. */
export interface UnarmoredCandidate {
  /** Rótulo para a ficha (ex.: "Defesa sem Armadura"). */
  label: string;
  /**
   * Valor **já somado** da fórmula: base + Destreza + o atributo da classe.
   * Elas não se acumulam entre si — vale a que der o maior valor.
   */
  value: number;
}

/** Resultado detalhado, usado pela ficha e pelo combate. */
export interface ArmorClassDetail {
  /** CA final: o override do mestre quando existe, senão a automática. */
  value: number;
  /** CA calculada pelas regras, sem override. */
  automatic: number;
  /** Override manual do mestre (`null` = cálculo automático). */
  override: number | null;
  armor: ArmorPiece | null;
  /** Escudo equipado (o PRIMEIRO encontrado); `null` sem escudo. */
  shield: ShieldPiece | null;
  /** Parcela da Destreza aplicada (0 com armadura pesada, no máximo +2 na média). */
  dexterityBonus: number;
  shieldBonus: number;
  magicBonus: number;
  /** Defesa sem armadura usada (quando não há armadura); `null` no padrão 10 + DES. */
  unarmoredLabel: string | null;
  /** Bônus fixos de classe aplicados (Estilo de Luta Defesa: +1). */
  classBonus: number;
  /** Rótulos dos bônus de classe aplicados (ex.: ["Estilo de Luta (Defesa)"]). */
  classBonusLabels: string[];
  /**
   * Proficiência do equipamento defensivo equipado (armadura por tipo e
   * escudo). Informativo: NÃO altera a CA (PHB 2014 — vestir armadura sem
   * proficiência mantém a CA; o que entra são as penalidades de não
   * proficiência, consumidas pela Fase 8).
   */
  armorProficiency: ArmorProficiencyState;
  /**
   * Não proficiência ATIVA: veste armadura/escudo do tipo sem proficiência.
   * É o gatilho das penalidades (desvantagem em testes/salvaguardas/ataques de
   * FOR ou DES e impossibilidade de conjurar magias). `true` só quando há
   * equipamento equipado sem proficiência.
   */
  armorNonProficiency: ArmorProficiencyState;
}

/** Bônus fixo de CA de uma classe (Estilo de Luta Defesa). */
export interface ClassArmorBonusInput {
  /** Rótulo para a ficha (ex.: "Estilo de Luta (Defesa)"). */
  label: string;
  /** Valor somado à CA. */
  value: number;
  /** Só vale com ARMADURA vestida (escudo sozinho não conta). */
  requiresArmor?: boolean;
}

const EMPTY_PIECES: ArmorClassPieces = {
  armor: null,
  shield: null,
  shieldBonus: 0,
  magicBonus: 0,
};

/** Mínimo que um item de inventário precisa ter para entrar na conta. */
export interface EquippedItemLike {
  name: string;
  category: string;
  slot: string | null;
  details: ItemDetails;
}

function armorTypeOf(value: unknown): ArmorType | null {
  return value === 'Leve' || value === 'Média' || value === 'Pesada' ? value : null;
}

/**
 * Separa o que o personagem tem equipado e que mexe na CA.
 *
 * - **Armadura**: categoria `Armadura` no slot de peitoral (`chest`) com
 *   `armorType` e `baseArmorClass` cadastrados pelo mestre. Sem esses campos
 *   (itens antigos) o item não vira armadura — só o bônus avulso dele conta.
 * - **Escudo**: qualquer item da categoria `Escudo` equipado soma o próprio
 *   `armorClassBonus`.
 * - **Bônus mágicos**: o `armorClassBonus` dos demais itens equipados (anéis,
 *   elmos, armadura mágica...) some ao total.
 */
export function armorPiecesFrom(items: readonly EquippedItemLike[]): ArmorClassPieces {
  const equipped = items.filter((item) => item.slot !== null);
  if (equipped.length === 0) return EMPTY_PIECES;

  let armor: ArmorPiece | null = null;
  let shield: ShieldPiece | null = null;
  let shieldBonus = 0;
  let magicBonus = 0;

  for (const item of equipped) {
    const bonus = item.details.armorClassBonus ?? 0;

    if (item.category === 'Escudo') {
      // Guarda o primeiro escudo para exibir/proficiência; a SOMA do bônus
      // continua valendo (comportamento anterior preservado).
      if (shield === null) shield = { name: item.name };
      shieldBonus += bonus;
      continue;
    }

    if (item.category === 'Armadura' && item.slot === 'chest') {
      const type = armorTypeOf(item.details.armorType);
      const base = item.details.baseArmorClass ?? 0;
      if (type && base > 0) {
        armor = { name: item.name, type, base };
        magicBonus += bonus;
        continue;
      }
    }

    magicBonus += bonus;
  }

  return { armor, shield, shieldBonus, magicBonus };
}

export interface ArmorClassInput {
  /** Modificador de Destreza. */
  dexterityModifier: number;
  pieces: ArmorClassPieces;
  /** Defesas sem armadura das classes (o padrão 10 + DES entra sempre). */
  unarmored?: readonly UnarmoredCandidate[];
  /** Bônus fixos de classe (Estilo de Luta Defesa). */
  classBonuses?: readonly ClassArmorBonusInput[];
  /**
   * Proficiências de armadura do personagem (`characters.proficiencies.armor`).
   * Só alimenta o ESTADO de proficiência — a CA automática não depende disso.
   */
  armorProficiencies?: readonly string[];
  /** Override manual do mestre (`null`/`0`/ausente = automático). */
  override?: number | null;
}

/** Calcula a CA aplicando armadura, escudo, bônus e o override do mestre. */
export function computeArmorClass(input: ArmorClassInput): ArmorClassDetail {
  const { pieces } = input;
  const override =
    input.override === undefined || input.override === null || input.override <= 0
      ? null
      : input.override;

  let automatic: number;
  let dexterityBonus = 0;
  let unarmoredLabel: string | null = null;

  if (pieces.armor) {
    dexterityBonus =
      pieces.armor.type === 'Pesada'
        ? 0
        : pieces.armor.type === 'Média'
          ? Math.min(input.dexterityModifier, 2)
          : input.dexterityModifier;
    automatic = pieces.armor.base + dexterityBonus;
  } else {
    const candidates: UnarmoredCandidate[] = [
      { label: '', value: 10 + input.dexterityModifier },
      ...(input.unarmored ?? []),
    ];
    const best = candidates.reduce(
      (top, candidate) => (candidate.value > top.value ? candidate : top),
      candidates[0],
    );
    automatic = best.value;
    unarmoredLabel = best.label || null;
  }

  // Escudo e bônus mágicos somam em qualquer situação.
  automatic += pieces.shieldBonus + pieces.magicBonus;

  // Bônus fixos de classe: o Estilo de Luta Defesa vale "enquanto você estiver
  // usando armadura" — escudo sozinho não conta como armadura.
  let classBonus = 0;
  const classBonusLabels: string[] = [];
  for (const bonus of input.classBonuses ?? []) {
    if (bonus.requiresArmor && pieces.armor === null) continue;
    classBonus += bonus.value;
    if (bonus.label) classBonusLabels.push(bonus.label);
  }
  automatic += classBonus;

  // Proficiência do equipamento defensivo (armadura por tipo + escudo). Só
  // informa: a CA acima NÃO muda por causa da falta de proficiência.
  const armorProficiency = armorProficiencyOf(input.armorProficiencies ?? [], pieces);
  const armorNonProficiency: ArmorProficiencyState = {
    armor: pieces.armor !== null && !armorProficiency.armor,
    shield: pieces.shield !== null && !armorProficiency.shield,
  };

  return {
    value: override ?? automatic,
    automatic,
    override,
    armor: pieces.armor,
    shield: pieces.shield,
    dexterityBonus,
    shieldBonus: pieces.shieldBonus,
    magicBonus: pieces.magicBonus,
    unarmoredLabel,
    classBonus,
    classBonusLabels,
    armorProficiency,
    armorNonProficiency,
  };
}
