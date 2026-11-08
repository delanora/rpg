import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import {
  sanitizeItemDetails,
  type AmmoType,
  type ArmorType,
  type ItemDetails,
} from '../modules/shared/item-details.js';
import { WEAPONS } from '../modules/shared/weapons/index.js';
import type { CanonicalWeapon } from '../modules/shared/weapons/types.js';

/**
 * Cadastra no catálogo de itens as ARMAS, as MUNIÇÕES e as ARMADURAS/ESCUDOS do
 * PHB 2014.
 *
 *   npm run seed:phb-items
 *
 * Por que existe: a MECÂNICA das 37 armas já vive em `shared/weapons/catalog`
 * (dano, propriedades, alcances, munição, id canônico) e a das armaduras em
 * `shared/armor-class` (a CA sai de `armorType` + `baseArmorClass`, e o escudo
 * de `armorClassBonus`). O que falta para tudo isso valer na ficha é o ITEM do
 * catálogo — é ele que o mestre envia para a mochila e o jogador equipa (arma
 * na mão, armadura no peitoral). Este script copia o catálogo canônico para
 * `items` e acrescenta o que a regra NÃO guarda (peso e preço do livro, que são
 * dados de comércio).
 *
 * Regras do script:
 * - **Idempotente**: arma casa por `details.canonicalWeaponId`, munição por
 *   `details.ammoType` e armadura/escudo por nome + categoria. Rodar de novo
 *   ATUALIZA em vez de duplicar.
 * - Nunca apaga item nenhum e nunca mexe em item sem vínculo canônico.
 * - Grava `details` pelo `sanitizeItemDetails` (a mesma barreira da rota), então
 *   o que o editor aceita é exatamente o que fica salvo.
 * - Alcance é INTEIRO em `details`: zarabatana (7,5 m) e rede (1,5/4,5 m) são
 *   arredondados ao gravar, como o editor do mestre já faz.
 */

/** 1 libra = 0,45359237 kg (o projeto guarda peso em kg). */
const LB_TO_KG = 0.45359237;

interface Price {
  gold?: number;
  silver?: number;
  copper?: number;
}

interface Commerce {
  /** Peso em LIBRAS, como na tabela do PHB (convertido para kg ao gravar). */
  weightLb: number;
  price: Price;
}

/**
 * Peso e preço das 37 armas (tabela "Weapons" do PHB 2014).
 * A chave é o `id` canônico de `shared/weapons/catalog.ts`.
 */
const PHB_COMMERCE: Record<string, Commerce> = {
  // Armas simples de corpo a corpo
  club: { weightLb: 2, price: { silver: 1 } },
  dagger: { weightLb: 1, price: { gold: 2 } },
  greatclub: { weightLb: 10, price: { silver: 2 } },
  handaxe: { weightLb: 2, price: { gold: 5 } },
  javelin: { weightLb: 2, price: { silver: 5 } },
  'light-hammer': { weightLb: 2, price: { gold: 2 } },
  mace: { weightLb: 4, price: { gold: 5 } },
  quarterstaff: { weightLb: 4, price: { silver: 2 } },
  sickle: { weightLb: 2, price: { gold: 1 } },
  spear: { weightLb: 3, price: { gold: 1 } },
  // Armas simples à distância
  'light-crossbow': { weightLb: 5, price: { gold: 25 } },
  dart: { weightLb: 0.25, price: { copper: 5 } },
  shortbow: { weightLb: 2, price: { gold: 25 } },
  sling: { weightLb: 0, price: { silver: 1 } },
  // Armas marciais de corpo a corpo
  battleaxe: { weightLb: 4, price: { gold: 10 } },
  flail: { weightLb: 2, price: { gold: 10 } },
  glaive: { weightLb: 6, price: { gold: 20 } },
  greataxe: { weightLb: 7, price: { gold: 30 } },
  greatsword: { weightLb: 6, price: { gold: 50 } },
  halberd: { weightLb: 6, price: { gold: 20 } },
  lance: { weightLb: 6, price: { gold: 10 } },
  longsword: { weightLb: 3, price: { gold: 15 } },
  maul: { weightLb: 10, price: { gold: 10 } },
  morningstar: { weightLb: 4, price: { gold: 15 } },
  pike: { weightLb: 18, price: { gold: 5 } },
  rapier: { weightLb: 2, price: { gold: 25 } },
  scimitar: { weightLb: 3, price: { gold: 25 } },
  shortsword: { weightLb: 2, price: { gold: 10 } },
  trident: { weightLb: 4, price: { gold: 5 } },
  'war-pick': { weightLb: 2, price: { gold: 5 } },
  warhammer: { weightLb: 2, price: { gold: 15 } },
  whip: { weightLb: 2, price: { gold: 2 } },
  // Armas marciais à distância
  blowgun: { weightLb: 1, price: { gold: 10 } },
  'hand-crossbow': { weightLb: 3, price: { gold: 75 } },
  'heavy-crossbow': { weightLb: 18, price: { gold: 50 } },
  longbow: { weightLb: 2, price: { gold: 50 } },
  net: { weightLb: 3, price: { gold: 1 } },
};

/**
 * Munições do PHB, POR UNIDADE (é a unidade que o ataque consome).
 *
 * O livro vende em pacotes (20 flechas = 1 po e 1 lb; 20 virotes = 1 po e 1,5 lb;
 * 20 balas de funda = 4 pc e 1,5 lb; 50 agulhas = 1 po e 1 lb), então o preço e o
 * peso por unidade saem da divisão. Onde a divisão não é inteira em cobre
 * (balas: 0,2 pc), o preço é arredondado PARA CIMA (1 pc) — o preço é informação
 * do mestre, não regra.
 */
const PHB_AMMO: {
  name: string;
  ammoType: AmmoType;
  description: string;
  weightKg: number;
  price: Price;
}[] = [
  {
    name: 'Flecha',
    ammoType: 'Flecha',
    description: 'Munição de arco e arco curto. O PHB vende 20 flechas por 1 po (peso 1 lb por 20).',
    weightKg: 0.02,
    price: { copper: 5 },
  },
  {
    name: 'Virote',
    ammoType: 'Virote',
    description: 'Munição de besta. O PHB vende 20 virotes por 1 po (peso 1,5 lb por 20).',
    weightKg: 0.03,
    price: { copper: 5 },
  },
  {
    name: 'Bala de funda',
    ammoType: 'Bala de funda',
    description:
      'Munição de funda. O PHB vende 20 balas por 4 pc (peso 1,5 lb por 20); o preço unitário foi arredondado para 1 pc.',
    weightKg: 0.03,
    price: { copper: 1 },
  },
  {
    name: 'Agulha de zarabatana',
    ammoType: 'Agulha de zarabatana',
    description: 'Munição de zarabatana. O PHB vende 50 agulhas por 1 po (peso 1 lb por 50).',
    weightKg: 0.01,
    price: { copper: 2 },
  },
];

/**
 * Armaduras e escudo do PHB 2014 (tabela "Armor").
 *
 * `baseArmorClass` é a CA base do livro — a Destreza entra (ou não) pelo
 * `armorType`, e quem calcula isso é `shared/armor-class.ts`, nunca o item.
 * `strength`/`stealthDisadvantage` são do LIVRO e vão só para a descrição: o
 * motor atual não automatiza requisito de Força nem desvantagem em Furtividade
 * (não há campo para isso em `details`).
 */
interface PhbArmor {
  name: string;
  nameEn: string;
  armorType: ArmorType;
  baseArmorClass: number;
  weightLb: number;
  price: Price;
  strength?: number;
  stealthDisadvantage?: boolean;
}

const PHB_ARMORS: PhbArmor[] = [
  // --- Armaduras leves (Destreza inteira) -----------------------------------
  {
    name: 'Acolchoada',
    nameEn: 'Padded',
    armorType: 'Leve',
    baseArmorClass: 11,
    weightLb: 8,
    price: { gold: 5 },
    stealthDisadvantage: true,
  },
  {
    name: 'Couro',
    nameEn: 'Leather',
    armorType: 'Leve',
    baseArmorClass: 11,
    weightLb: 10,
    price: { gold: 10 },
  },
  {
    name: 'Couro batido',
    nameEn: 'Studded leather',
    armorType: 'Leve',
    baseArmorClass: 12,
    weightLb: 13,
    price: { gold: 45 },
  },
  // --- Armaduras médias (Destreza no máximo +2) -----------------------------
  {
    name: 'Peles',
    nameEn: 'Hide',
    armorType: 'Média',
    baseArmorClass: 12,
    weightLb: 12,
    price: { gold: 10 },
  },
  {
    name: 'Camisão de malha',
    nameEn: 'Chain shirt',
    armorType: 'Média',
    baseArmorClass: 13,
    weightLb: 20,
    price: { gold: 50 },
  },
  {
    name: 'Cota de escamas',
    nameEn: 'Scale mail',
    armorType: 'Média',
    baseArmorClass: 14,
    weightLb: 45,
    price: { gold: 50 },
    stealthDisadvantage: true,
  },
  {
    name: 'Peitoral',
    nameEn: 'Breastplate',
    armorType: 'Média',
    baseArmorClass: 14,
    weightLb: 20,
    price: { gold: 400 },
  },
  {
    name: 'Meia armadura',
    nameEn: 'Half plate',
    armorType: 'Média',
    baseArmorClass: 15,
    weightLb: 40,
    price: { gold: 750 },
    stealthDisadvantage: true,
  },
  // --- Armaduras pesadas (Destreza não conta) -------------------------------
  {
    name: 'Cota de anéis',
    nameEn: 'Ring mail',
    armorType: 'Pesada',
    baseArmorClass: 14,
    weightLb: 40,
    price: { gold: 30 },
    stealthDisadvantage: true,
  },
  {
    name: 'Cota de malha',
    nameEn: 'Chain mail',
    armorType: 'Pesada',
    baseArmorClass: 16,
    weightLb: 55,
    price: { gold: 75 },
    strength: 13,
    stealthDisadvantage: true,
  },
  {
    name: 'Armadura de talas',
    nameEn: 'Splint',
    armorType: 'Pesada',
    baseArmorClass: 17,
    weightLb: 60,
    price: { gold: 200 },
    strength: 15,
    stealthDisadvantage: true,
  },
  {
    name: 'Armadura de placas',
    nameEn: 'Plate',
    armorType: 'Pesada',
    baseArmorClass: 18,
    weightLb: 65,
    price: { gold: 1500 },
    strength: 15,
    stealthDisadvantage: true,
  },
];

/** O único escudo do PHB 2014: +2 de CA, ocupa uma mão. */
const PHB_SHIELD = {
  name: 'Escudo',
  nameEn: 'Shield',
  armorClassBonus: 2,
  weightLb: 6,
  price: { gold: 10 },
} as const;

/**
 * ITENS GERAIS do PHB 2014 ("Adventuring Gear" + focos de conjuração).
 *
 * `consumable` marca o que o jogador USA e consome 1 unidade (ácido, tocha,
 * rações...). Os focos e a bolsa de componentes carregam as TAGS MECÂNICAS de
 * 6.6G (`spellFocusKinds`/`componentPouch`/`wornVisible`) — a identidade é a TAG,
 * nunca o nome, e essas chaves sobrevivem ao `sanitizeItemDetails` em qualquer
 * categoria.
 *
 * Peso em libras como na tabela do livro (`—` vira 0).
 */
interface PhbGear {
  name: string;
  nameEn: string;
  weightLb: number;
  price: Price;
  consumable?: boolean;
  spellFocusKinds?: PhbFocusKind[];
  componentPouch?: boolean;
  wornVisible?: boolean;
  note?: string;
}

type PhbFocusKind = 'arcane' | 'holy-symbol' | 'druidic' | 'musical-instrument';

const PHB_GEAR: PhbGear[] = [
  { name: 'Ábaco', nameEn: 'Abacus', weightLb: 2, price: { gold: 2 } },
  {
    name: 'Ácido (frasco)',
    nameEn: 'Acid (vial)',
    weightLb: 1,
    price: { gold: 25 },
    consumable: true,
    note: 'No livro: 2d6 de dano de ácido num alvo a até 1,5 m (não automatizado).',
  },
  {
    name: 'Fogo de alquimista (frasco)',
    nameEn: "Alchemist's fire (flask)",
    weightLb: 1,
    price: { gold: 50 },
    consumable: true,
    note: 'No livro: 1d4 de fogo por rodada até apagar (não automatizado).',
  },
  { name: 'Antitoxina (frasco)', nameEn: 'Antitoxin (vial)', weightLb: 0, price: { gold: 50 }, consumable: true },
  { name: 'Mochila', nameEn: 'Backpack', weightLb: 5, price: { gold: 2 } },
  {
    name: 'Esferas de metal (saco com 1.000)',
    nameEn: 'Ball bearings (bag of 1,000)',
    weightLb: 2,
    price: { gold: 1 },
    consumable: true,
  },
  { name: 'Barril', nameEn: 'Barrel', weightLb: 70, price: { gold: 2 } },
  { name: 'Cesto', nameEn: 'Basket', weightLb: 2, price: { silver: 4 } },
  { name: 'Saco de dormir', nameEn: 'Bedroll', weightLb: 7, price: { gold: 1 } },
  { name: 'Sino', nameEn: 'Bell', weightLb: 0, price: { gold: 1 } },
  { name: 'Cobertor', nameEn: 'Blanket', weightLb: 3, price: { silver: 5 } },
  { name: 'Talha', nameEn: 'Block and tackle', weightLb: 5, price: { gold: 1 } },
  { name: 'Livro', nameEn: 'Book', weightLb: 5, price: { gold: 25 } },
  { name: 'Garrafa de vidro', nameEn: 'Bottle, glass', weightLb: 2, price: { gold: 2 } },
  { name: 'Balde', nameEn: 'Bucket', weightLb: 2, price: { copper: 5 } },
  { name: 'Estrepes (saco com 20)', nameEn: 'Caltrops (bag of 20)', weightLb: 2, price: { gold: 1 }, consumable: true },
  { name: 'Vela', nameEn: 'Candle', weightLb: 0, price: { copper: 1 }, consumable: true },
  { name: 'Estojo para virotes', nameEn: 'Case, crossbow bolt', weightLb: 1, price: { gold: 1 } },
  { name: 'Estojo para mapa ou pergaminho', nameEn: 'Case, map or scroll', weightLb: 1, price: { gold: 1 } },
  { name: 'Corrente (3 metros)', nameEn: 'Chain (10 feet)', weightLb: 10, price: { gold: 5 } },
  { name: 'Giz (1 peça)', nameEn: 'Chalk (1 piece)', weightLb: 0, price: { copper: 1 }, consumable: true },
  { name: 'Baú', nameEn: 'Chest', weightLb: 25, price: { gold: 5 } },
  { name: 'Kit de escalada', nameEn: "Climber's kit", weightLb: 12, price: { gold: 25 } },
  { name: 'Roupas comuns', nameEn: 'Clothes, common', weightLb: 3, price: { silver: 5 } },
  { name: 'Roupas de fantasia', nameEn: 'Clothes, costume', weightLb: 4, price: { gold: 5 } },
  { name: 'Roupas finas', nameEn: 'Clothes, fine', weightLb: 6, price: { gold: 15 } },
  { name: 'Roupas de viajante', nameEn: "Clothes, traveler's", weightLb: 4, price: { gold: 2 } },
  {
    name: 'Bolsa de componentes',
    nameEn: 'Component pouch',
    weightLb: 2,
    price: { gold: 25 },
    componentPouch: true,
  },
  { name: 'Pé de cabra', nameEn: 'Crowbar', weightLb: 5, price: { gold: 2 } },
  { name: 'Conjunto de dados', nameEn: 'Dice set', weightLb: 0, price: { silver: 1 } },
  { name: 'Conjunto de xadrez do dragão', nameEn: 'Dragonchess set', weightLb: 0, price: { gold: 1 } },
  { name: 'Equipamento de pesca', nameEn: 'Fishing tackle', weightLb: 4, price: { gold: 1 } },
  { name: 'Frasco ou caneca', nameEn: 'Flask or tankard', weightLb: 1, price: { copper: 2 } },
  { name: 'Gancho de escalada', nameEn: 'Grappling hook', weightLb: 4, price: { gold: 2 } },
  { name: 'Martelo', nameEn: 'Hammer', weightLb: 3, price: { gold: 1 } },
  { name: 'Marreta', nameEn: 'Hammer, sledge', weightLb: 10, price: { gold: 2 } },
  { name: 'Kit de cura', nameEn: "Healer's kit", weightLb: 3, price: { gold: 5 }, consumable: true },
  {
    name: 'Água benta (frasco)',
    nameEn: 'Holy water (flask)',
    weightLb: 1,
    price: { gold: 25 },
    consumable: true,
    note: 'No livro: 2d6 de dano radiante em corruptores mortos-vivos (não automatizado).',
  },
  { name: 'Armadilha de caça', nameEn: 'Hunting trap', weightLb: 25, price: { gold: 5 } },
  { name: 'Tinta (frasco de 30 g)', nameEn: 'Ink (1 ounce bottle)', weightLb: 0, price: { gold: 10 }, consumable: true },
  { name: 'Pena de escrever', nameEn: 'Ink pen', weightLb: 0, price: { copper: 2 } },
  { name: 'Jarra ou caneco', nameEn: 'Jug or pitcher', weightLb: 4, price: { copper: 2 } },
  { name: 'Escada (3 metros)', nameEn: 'Ladder (10-foot)', weightLb: 25, price: { silver: 1 } },
  { name: 'Lâmpada', nameEn: 'Lamp', weightLb: 1, price: { silver: 5 } },
  { name: 'Lanterna furta-fogo', nameEn: 'Lantern, bullseye', weightLb: 2, price: { gold: 10 } },
  { name: 'Lanterna coberta', nameEn: 'Lantern, hooded', weightLb: 2, price: { gold: 5 } },
  { name: 'Fechadura', nameEn: 'Lock', weightLb: 1, price: { gold: 10 } },
  { name: 'Lupa', nameEn: 'Magnifying glass', weightLb: 0, price: { gold: 100 } },
  { name: 'Algemas', nameEn: 'Manacles', weightLb: 6, price: { gold: 2 } },
  { name: 'Kit de refeição', nameEn: 'Mess kit', weightLb: 1, price: { silver: 2 } },
  { name: 'Espelho de aço', nameEn: 'Mirror, steel', weightLb: 0.5, price: { gold: 5 } },
  { name: 'Óleo (frasco)', nameEn: 'Oil (flask)', weightLb: 1, price: { silver: 1 }, consumable: true },
  { name: 'Papel (uma folha)', nameEn: 'Paper (one sheet)', weightLb: 0, price: { silver: 2 }, consumable: true },
  { name: 'Pergaminho (uma folha)', nameEn: 'Parchment (one sheet)', weightLb: 0, price: { silver: 1 }, consumable: true },
  { name: 'Perfume (frasco)', nameEn: 'Perfume (vial)', weightLb: 0, price: { gold: 5 }, consumable: true },
  { name: 'Picareta de minerador', nameEn: "Pick, miner's", weightLb: 10, price: { gold: 2 } },
  { name: 'Estaca de ferro', nameEn: 'Piton', weightLb: 0.25, price: { copper: 5 } },
  { name: 'Conjunto de cartas', nameEn: 'Playing card set', weightLb: 0, price: { silver: 5 } },
  { name: 'Kit de envenenador', nameEn: "Poisoner's kit", weightLb: 2, price: { gold: 50 } },
  { name: 'Vara (3 metros)', nameEn: 'Pole (10-foot)', weightLb: 7, price: { copper: 5 } },
  { name: 'Panela de ferro', nameEn: 'Pot, iron', weightLb: 10, price: { gold: 2 } },
  { name: 'Bolsa', nameEn: 'Pouch', weightLb: 1, price: { silver: 5 } },
  { name: 'Aljava', nameEn: 'Quiver', weightLb: 1, price: { gold: 1 } },
  { name: 'Aríete portátil', nameEn: 'Ram, portable', weightLb: 35, price: { gold: 4 } },
  { name: 'Rações (1 dia)', nameEn: 'Rations (1 day)', weightLb: 2, price: { silver: 5 }, consumable: true },
  { name: 'Vestes', nameEn: 'Robes', weightLb: 4, price: { gold: 1 } },
  { name: 'Corda de cânhamo (15 metros)', nameEn: 'Rope, hempen (50 feet)', weightLb: 10, price: { gold: 1 } },
  { name: 'Corda de seda (15 metros)', nameEn: 'Rope, silk (50 feet)', weightLb: 5, price: { gold: 10 } },
  { name: 'Saco', nameEn: 'Sack', weightLb: 0.5, price: { copper: 1 } },
  { name: 'Balança de mercador', nameEn: "Scale, merchant's", weightLb: 3, price: { gold: 5 } },
  { name: 'Cera de selar', nameEn: 'Sealing wax', weightLb: 0, price: { silver: 5 } },
  { name: 'Pá', nameEn: 'Shovel', weightLb: 5, price: { gold: 2 } },
  { name: 'Apito de sinal', nameEn: 'Signal whistle', weightLb: 0, price: { copper: 5 } },
  { name: 'Anel de sinete', nameEn: 'Signet ring', weightLb: 0, price: { gold: 5 } },
  { name: 'Sabão', nameEn: 'Soap', weightLb: 0, price: { copper: 2 }, consumable: true },
  { name: 'Livro de magias', nameEn: 'Spellbook', weightLb: 3, price: { gold: 50 } },
  { name: 'Pregos de ferro (10)', nameEn: 'Spikes, iron (10)', weightLb: 5, price: { gold: 1 } },
  { name: 'Luneta', nameEn: 'Spyglass', weightLb: 1, price: { gold: 1000 } },
  { name: 'Tenda para duas pessoas', nameEn: 'Tent (two-person)', weightLb: 20, price: { gold: 2 } },
  { name: 'Caixa de fogo', nameEn: 'Tinderbox', weightLb: 1, price: { silver: 5 } },
  { name: 'Tocha', nameEn: 'Torch', weightLb: 1, price: { copper: 1 }, consumable: true },
  { name: 'Frasco pequeno', nameEn: 'Vial', weightLb: 0, price: { gold: 1 } },
  { name: 'Cantil', nameEn: 'Waterskin', weightLb: 5, price: { silver: 2 } },
  { name: 'Pedra de amolar', nameEn: 'Whetstone', weightLb: 1, price: { copper: 1 } },
  // --- Focos de conjuração (6.6G): a TAG é a identidade, nunca o nome ------
  { name: 'Cristal (foco arcano)', nameEn: 'Arcane focus, crystal', weightLb: 1, price: { gold: 10 }, spellFocusKinds: ['arcane'] },
  { name: 'Orbe (foco arcano)', nameEn: 'Arcane focus, orb', weightLb: 3, price: { gold: 20 }, spellFocusKinds: ['arcane'] },
  { name: 'Vara (foco arcano)', nameEn: 'Arcane focus, rod', weightLb: 2, price: { gold: 10 }, spellFocusKinds: ['arcane'] },
  { name: 'Cajado (foco arcano)', nameEn: 'Arcane focus, staff', weightLb: 4, price: { gold: 5 }, spellFocusKinds: ['arcane'] },
  { name: 'Varinha (foco arcano)', nameEn: 'Arcane focus, wand', weightLb: 1, price: { gold: 10 }, spellFocusKinds: ['arcane'] },
  { name: 'Ramo de visco (foco druídico)', nameEn: 'Druidic focus, sprig of mistletoe', weightLb: 0, price: { gold: 1 }, spellFocusKinds: ['druidic'] },
  { name: 'Totem (foco druídico)', nameEn: 'Druidic focus, totem', weightLb: 0, price: { gold: 1 }, spellFocusKinds: ['druidic'] },
  { name: 'Cajado de madeira (foco druídico)', nameEn: 'Druidic focus, wooden staff', weightLb: 4, price: { gold: 5 }, spellFocusKinds: ['druidic'] },
  { name: 'Varinha de teixo (foco druídico)', nameEn: 'Druidic focus, yew wand', weightLb: 1, price: { gold: 10 }, spellFocusKinds: ['druidic'] },
  {
    name: 'Amuleto (símbolo sagrado)',
    nameEn: 'Holy symbol, amulet',
    weightLb: 1,
    price: { gold: 5 },
    spellFocusKinds: ['holy-symbol'],
    wornVisible: true,
  },
  {
    name: 'Emblema (símbolo sagrado)',
    nameEn: 'Holy symbol, emblem',
    weightLb: 0,
    price: { gold: 5 },
    spellFocusKinds: ['holy-symbol'],
    wornVisible: true,
  },
  {
    name: 'Relicário (símbolo sagrado)',
    nameEn: 'Holy symbol, reliquary',
    weightLb: 2,
    price: { gold: 5 },
    spellFocusKinds: ['holy-symbol'],
    wornVisible: true,
  },
];

/**
 * PACOTES DE EQUIPAMENTO do PHB 2014.
 *
 * Cada pacote entra como UM item do catálogo com o conteúdo listado na
 * descrição: o projeto não tem o conceito de kit que se desmembra em itens, e
 * inventar isso agora seria uma segunda regra de inventário. O peso fica em 0
 * (o livro não informa o do pacote) — quem quiser peso real soma os itens.
 */
interface PhbPack {
  name: string;
  nameEn: string;
  price: Price;
  contents: string[];
}

const PHB_PACKS: PhbPack[] = [
  {
    name: 'Pacote de assaltante',
    nameEn: "Burglar's pack",
    price: { gold: 16 },
    contents: [
      'mochila',
      'saco com 1.000 esferas de metal',
      '3 m de corda',
      'sino',
      '5 velas',
      'pé de cabra',
      'martelo',
      '10 estacas de ferro',
      'lanterna coberta',
      '2 frascos de óleo',
      '5 dias de rações',
      'caixa de fogo',
      'cantil',
      '15 m de corda de cânhamo',
    ],
  },
  {
    name: 'Pacote de diplomata',
    nameEn: "Diplomat's pack",
    price: { gold: 39 },
    contents: [
      'baú',
      '2 estojos para mapa ou pergaminho',
      'roupas finas',
      'frasco de tinta',
      'pena de escrever',
      'lâmpada',
      '2 frascos de óleo',
      '5 folhas de papel',
      'perfume',
      'cera de selar',
      'sabão',
    ],
  },
  {
    name: 'Pacote de explorador de masmorras',
    nameEn: "Dungeoneer's pack",
    price: { gold: 12 },
    contents: [
      'mochila',
      'pé de cabra',
      'martelo',
      '10 estacas de ferro',
      '10 tochas',
      'caixa de fogo',
      '10 dias de rações',
      'cantil',
      '15 m de corda de cânhamo',
    ],
  },
  {
    name: 'Pacote de artista',
    nameEn: "Entertainer's pack",
    price: { gold: 40 },
    contents: [
      'mochila',
      'saco de dormir',
      '2 figurinos',
      '5 velas',
      '5 dias de rações',
      'cantil',
      'kit de disfarce',
    ],
  },
  {
    name: 'Pacote de aventureiro',
    nameEn: "Explorer's pack",
    price: { gold: 10 },
    contents: [
      'mochila',
      'saco de dormir',
      'kit de refeição',
      'caixa de fogo',
      '10 tochas',
      '10 dias de rações',
      'cantil',
      '15 m de corda de cânhamo',
    ],
  },
  {
    name: 'Pacote de sacerdote',
    nameEn: "Priest's pack",
    price: { gold: 33 },
    contents: [
      'mochila',
      'cobertor',
      '10 velas',
      'caixa de fogo',
      'caixa de esmolas',
      '2 blocos de incenso',
      'turíbulo',
      'vestes',
      '2 dias de rações',
      'cantil',
    ],
  },
  {
    name: 'Pacote de estudioso',
    nameEn: "Scholar's pack",
    price: { gold: 40 },
    contents: [
      'mochila',
      'livro de saber',
      'frasco de tinta',
      'pena de escrever',
      '5 folhas de pergaminho',
      'saquinho de areia',
      'faca pequena',
    ],
  },
];

const FOCUS_LABELS: Record<PhbFocusKind, string> = {
  arcane: 'foco arcano',
  'holy-symbol': 'símbolo sagrado',
  druidic: 'foco druídico',
  'musical-instrument': 'instrumento musical',
};

/** Descrição do item geral: factual e com as tags mecânicas declaradas. */
function gearDescription(gear: PhbGear): string {
  const parts = [`${gear.name} (${gear.nameEn}) — equipamento do PHB 2014.`];
  if (gear.spellFocusKinds?.length) {
    parts.push(`Serve como ${gear.spellFocusKinds.map((kind) => FOCUS_LABELS[kind]).join(' ou ')}.`);
  }
  if (gear.componentPouch) {
    parts.push('Substitui materiais comuns sem custo declarado pela magia.');
  }
  if (gear.wornVisible) {
    parts.push('Usado visivelmente: satisfaz material comum sem ocupar a mão.');
  }
  if (gear.consumable) parts.push('Pode ser usado pelo jogador: consome 1 unidade.');
  if (gear.note) parts.push(gear.note);
  return parts.join(' ');
}

function packDescription(pack: PhbPack): string {
  return `${pack.name} (${pack.nameEn}) — pacote de equipamento do PHB 2014. Contém: ${pack.contents.join('; ')}. Entra como UM item: o conteúdo não é separado automaticamente e o peso fica em 0.`;
}

/** Rótulos em PT das propriedades de arma — só para a descrição da ficha. */
const PROPERTY_LABELS: Record<string, string> = {
  light: 'leve',
  finesse: 'acuidade',
  heavy: 'pesada',
  'two-handed': 'duas mãos',
  versatile: 'versátil',
  thrown: 'arremesso',
  reach: 'alcance',
  ammunition: 'munição',
  loading: 'recarga',
  special: 'especial',
};

function roundWeight(lb: number): number {
  return Math.round(lb * LB_TO_KG * 100) / 100;
}

/** Descrição curta e factual da arma, montada a partir do catálogo. */
function weaponDescription(weapon: CanonicalWeapon): string {
  const kind = `${weapon.category === 'simple' ? 'simples' : 'marcial'} ${
    weapon.type === 'ranged' ? 'à distância' : 'corpo a corpo'
  }`;
  // A descrição mostra o MESMO dado que fica em `details` (arredondado), para
  // não prometer um alcance que a ficha não vai usar.
  const dice =
    weapon.damageDie.sides > 0
      ? `${weapon.damageDie.count}d${weapon.damageDie.sides} de ${weapon.damageType.toLowerCase()}`
      : weapon.damageBonus
        ? `${weapon.damageBonus} (fixo) de ${weapon.damageType.toLowerCase()}`
        : 'nenhum';
  const parts = [`${weapon.namePt} — arma ${kind}. Dano ${dice}.`];
  if (weapon.versatileDie) parts.push(`Empunhada com as duas mãos: 1d${weapon.versatileDie}.`);
  if (weapon.rangeNormal !== undefined && weapon.rangeLong !== undefined) {
    parts.push(`Alcance ${Math.round(weapon.rangeNormal)}/${Math.round(weapon.rangeLong)} m.`);
  }
  if (weapon.ammoType) parts.push(`Munição: ${weapon.ammoType}.`);
  if (weapon.properties.length > 0) {
    parts.push(`Propriedades: ${weapon.properties.map((p) => PROPERTY_LABELS[p] ?? p).join(', ')}.`);
  }
  return parts.join(' ');
}

/** Descrição da armadura: CA e como a Destreza entra (a conta é do motor). */
function armorDescription(armor: PhbArmor): string {
  const type =
    armor.armorType === 'Leve'
      ? 'armadura leve'
      : armor.armorType === 'Média'
        ? 'armadura média'
        : 'armadura pesada';
  const dex =
    armor.armorType === 'Pesada'
      ? 'Destreza não conta'
      : armor.armorType === 'Média'
        ? 'Destreza no máximo +2'
        : 'Destreza inteira';
  const parts = [`${armor.name} — ${type}. CA ${armor.baseArmorClass} (${dex}).`];
  if (armor.strength) parts.push(`No livro: requer Força ${armor.strength}.`);
  if (armor.stealthDisadvantage) {
    parts.push('No livro: desvantagem em Furtividade (ainda não automatizado).');
  }
  return parts.join(' ');
}

/** `details` da arma: catálogo canônico + vínculo (`canonicalWeaponId`). */
function weaponDetails(weapon: CanonicalWeapon): ItemDetails {
  const details: ItemDetails = {
    damageCount: weapon.damageDie.count,
    damageDie: weapon.damageDie.sides,
    damageType: weapon.damageType,
    weaponType: weapon.type,
    weaponCategory: weapon.category,
    properties: [...weapon.properties],
    canonicalWeaponId: weapon.id,
  };
  if (weapon.versatileDie !== undefined) details.versatileDie = weapon.versatileDie;
  if (weapon.damageBonus !== undefined) details.damageBonus = weapon.damageBonus;
  // `details` exige alcance INTEIRO e os DOIS valores para arma à distância ou
  // arremessável — o arredondamento é o mesmo que o editor do mestre aplica.
  if (weapon.rangeNormal !== undefined && weapon.rangeLong !== undefined) {
    details.rangeNormal = Math.round(weapon.rangeNormal);
    details.rangeLong = Math.round(weapon.rangeLong);
  }
  if (weapon.ammoType !== undefined) details.ammoType = weapon.ammoType;
  return details;
}

/** Comparação estável para saber se a linha já está como o script quer. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

interface SeedRow {
  /** Chave de idempotência (arma canônica, tipo de munição ou armadura). */
  key: string;
  /** Como a linha existente é encontrada (arma/munição têm melhor chave). */
  match: { canonicalWeaponId?: string; ammoType?: string; nameCategory?: boolean };
  name: string;
  description: string;
  weight: number;
  category: 'Arma' | 'Munição' | 'Armadura' | 'Escudo' | 'Item Geral';
  details: ItemDetails;
  price: { gold: number; silver: number; copper: number };
}

function priceOf(price: Price): { gold: number; silver: number; copper: number } {
  return { gold: price.gold ?? 0, silver: price.silver ?? 0, copper: price.copper ?? 0 };
}

function buildRows(): SeedRow[] {
  const rows: SeedRow[] = [];
  for (const weapon of WEAPONS) {
    const commerce = PHB_COMMERCE[weapon.id];
    if (!commerce) throw new Error(`Sem peso/preço do PHB para a arma "${weapon.id}".`);
    rows.push({
      key: `weapon:${weapon.id}`,
      match: { canonicalWeaponId: weapon.id },
      name: weapon.namePt,
      description: weaponDescription(weapon),
      weight: roundWeight(commerce.weightLb),
      category: 'Arma',
      details: sanitizeItemDetails('Arma', weaponDetails(weapon)),
      price: priceOf(commerce.price),
    });
  }
  for (const ammo of PHB_AMMO) {
    rows.push({
      key: `ammo:${ammo.name}`,
      match: { ammoType: ammo.ammoType },
      name: ammo.name,
      description: ammo.description,
      weight: ammo.weightKg,
      category: 'Munição',
      details: sanitizeItemDetails('Munição', { ammoType: ammo.ammoType }),
      price: priceOf(ammo.price),
    });
  }
  for (const armor of PHB_ARMORS) {
    rows.push({
      key: `armor:${armor.armorType}:${armor.name}`,
      match: { nameCategory: true },
      name: armor.name,
      description: armorDescription(armor),
      weight: roundWeight(armor.weightLb),
      category: 'Armadura',
      details: sanitizeItemDetails('Armadura', {
        armorType: armor.armorType,
        baseArmorClass: armor.baseArmorClass,
      }),
      price: priceOf(armor.price),
    });
  }
  rows.push({
    key: `shield:${PHB_SHIELD.name}`,
    match: { nameCategory: true },
    name: PHB_SHIELD.name,
    description: `Escudo — +${PHB_SHIELD.armorClassBonus} de CA. Ocupa uma mão; o bônus soma em qualquer situação.`,
    weight: roundWeight(PHB_SHIELD.weightLb),
    category: 'Escudo',
    details: sanitizeItemDetails('Escudo', {
      armorClassBonus: PHB_SHIELD.armorClassBonus,
    }),
    price: priceOf(PHB_SHIELD.price),
  });
  for (const gear of PHB_GEAR) {
    rows.push({
      key: `gear:${gear.name}`,
      match: { nameCategory: true },
      name: gear.name,
      description: gearDescription(gear),
      weight: roundWeight(gear.weightLb),
      category: 'Item Geral',
      details: sanitizeItemDetails('Item Geral', {
        ...(gear.consumable ? { consumable: true } : {}),
        ...(gear.spellFocusKinds ? { spellFocusKinds: gear.spellFocusKinds } : {}),
        ...(gear.componentPouch ? { componentPouch: true } : {}),
        ...(gear.wornVisible ? { wornVisible: true } : {}),
      }),
      price: priceOf(gear.price),
    });
  }
  for (const pack of PHB_PACKS) {
    rows.push({
      key: `pack:${pack.name}`,
      match: { nameCategory: true },
      name: pack.name,
      description: packDescription(pack),
      weight: 0,
      category: 'Item Geral',
      details: sanitizeItemDetails('Item Geral', {}),
      price: priceOf(pack.price),
    });
  }
  return rows;
}

/** Id de arma canônica já vinculado ao item (ou `null`). */
function canonicalIdOf(details: unknown): string | null {
  if (!details || typeof details !== 'object') return null;
  const value = (details as Record<string, unknown>).canonicalWeaponId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function ammoTypeOf(details: unknown): string | null {
  if (!details || typeof details !== 'object') return null;
  const value = (details as Record<string, unknown>).ammoType;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function main(): Promise<void> {
  const rows = buildRows();
  const items = await prisma.item.findMany({
    select: {
      id: true,
      name: true,
      category: true,
      description: true,
      weight: true,
      details: true,
      priceGold: true,
      priceSilver: true,
      priceCopper: true,
    },
  });

  const byCanonical = new Map<string, (typeof items)[number]>();
  const byAmmoType = new Map<string, (typeof items)[number]>();
  const byNameCategory = new Map<string, (typeof items)[number]>();
  for (const item of items) {
    const canonical = canonicalIdOf(item.details);
    if (canonical && !byCanonical.has(canonical)) byCanonical.set(canonical, item);
    if (item.category === 'Munição') {
      const ammo = ammoTypeOf(item.details);
      if (ammo && !byAmmoType.has(ammo)) byAmmoType.set(ammo, item);
    }
    // Armadura/escudo não têm id canônico no schema: a chave é nome + categoria.
    const nameKey = `${item.category}::${item.name.trim().toLowerCase()}`;
    if (!byNameCategory.has(nameKey)) byNameCategory.set(nameKey, item);
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const row of rows) {
    const existing = row.match.canonicalWeaponId
      ? byCanonical.get(row.match.canonicalWeaponId)
      : row.match.ammoType
        ? byAmmoType.get(row.match.ammoType)
        : byNameCategory.get(`${row.category}::${row.name.trim().toLowerCase()}`);

    const details = row.details as Prisma.InputJsonValue;
    if (!existing) {
      await prisma.item.create({
        data: {
          name: row.name,
          description: row.description,
          weight: row.weight,
          category: row.category,
          rarity: null,
          requiresAttunement: false,
          imageUrl: '',
          details,
          priceGold: row.price.gold,
          priceSilver: row.price.silver,
          priceCopper: row.price.copper,
          campSupplyEnabled: false,
          campSupplyValue: 0,
        },
      });
      created += 1;
      continue;
    }

    // Só grava o que mudou: rodar o script de novo não infla `version` à toa.
    const same =
      existing.name === row.name &&
      existing.description === row.description &&
      existing.weight === row.weight &&
      existing.category === row.category &&
      existing.priceGold === row.price.gold &&
      existing.priceSilver === row.price.silver &&
      existing.priceCopper === row.price.copper &&
      stableStringify(existing.details) === stableStringify(row.details);

    if (same) {
      unchanged += 1;
      continue;
    }

    await prisma.item.update({
      where: { id: existing.id },
      data: {
        name: row.name,
        description: row.description,
        weight: row.weight,
        category: row.category,
        details,
        priceGold: row.price.gold,
        priceSilver: row.price.silver,
        priceCopper: row.price.copper,
        version: { increment: 1 },
      },
    });
    updated += 1;
  }

  console.log(
    `✔ Catálogo do PHB 2014: ${created} criado(s), ${updated} atualizado(s), ${unchanged} já estava(m) igual(is) — ${rows.length} linha(s) no total (${WEAPONS.length} armas + ${PHB_AMMO.length} munições + ${PHB_ARMORS.length} armaduras + 1 escudo + ${PHB_GEAR.length} itens gerais + ${PHB_PACKS.length} pacotes).`,
  );
}

main()
  .catch((error) => {
    console.error('❌ Falha ao popular o catálogo do PHB 2014:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
