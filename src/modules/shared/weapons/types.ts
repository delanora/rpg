import type { DamageType } from '../attacks.js';
import type {
  AmmoType,
  WeaponCategory,
  WeaponProperty,
  WeaponType,
} from '../item-details.js';

/**
 * Catálogo canônico das armas do Livro do Jogador (PHB 2014).
 *
 * Fonte única de verdade sobre as armas: o `id` estável (slug em inglês,
 * kebab-case) é o que fica gravado em `item.details.canonicalWeaponId` e é o que
 * a proficiência de arma por item específico compara (ver `shared/weapon-attacks`).
 *
 * Os campos de uso (`category`, `type`, `properties`, `versatileDie`) REAPROVEITAM
 * os tipos já existentes em `shared/item-details.ts` — nada de enum paralelo. O
 * dano (`damageDie`/`damageType`/`damageBonus`) é a referência do livro; serve
 * para exibir e para o editor sugerir os campos ao vincular a arma.
 *
 * Ver `catalog.ts` para a lista fechada.
 */
export interface CanonicalWeapon {
  /** Slug em inglês, kebab-case e estável (ex.: "battleaxe", "hand-crossbow"). */
  id: string;
  /** Nome em português, como aparece na ficha. */
  namePt: string;
  /** Nome em inglês — só referência do livro. */
  nameEn: string;
  /** Simples ou marcial (PHB). */
  category: WeaponCategory;
  /** Corpo a corpo ou à distância. */
  type: WeaponType;
  /** Propriedades do PHB marcadas na arma. */
  properties: WeaponProperty[];
  /** Dado do dano empunhada com as DUAS MÃOS (quando houver `versatile`). */
  versatileDie?: number;
  /** Dados de dano do ataque base (ex.: espada grande = 2d6). */
  damageDie: { count: number; sides: number };
  /** Tipo de dano canônico (mesma string de `shared/attacks.ts`). */
  damageType: DamageType;
  /**
   * Bônus fixo de dano, quando o livro traz dano plano (ex.: zarabatana = 1).
   * Ausente na grande maioria das armas.
   */
  damageBonus?: number;
  /**
   * Alcance normal/longo em METROS (1 pé = 0,3 m), para armas à distância ou
   * arremessáveis. Pode ser fracionário (ex.: zarabatana 7,5 m) — o editor
   * arredonda ao gravar, porque `item.details.rangeNormal/rangeLong` são inteiros.
   */
  rangeNormal?: number;
  rangeLong?: number;
  /** Munição consumida, quando a arma tem a propriedade `ammunition`. */
  ammoType?: AmmoType;
}
