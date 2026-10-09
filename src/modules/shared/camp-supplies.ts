/**
 * Constantes da mecânica OPCIONAL de RECURSOS DE ACAMPAMENTO do Descanso Longo
 * coletivo (inspirada no fluxo de Baldur's Gate 3 — NÃO é regra do PHB 2014).
 *
 * Ficam em `shared` para que a configuração da mesa (game-config) e o fluxo do
 * Descanso Longo (rest) usem os MESMOS limites sem criar dependência circular
 * entre os dois módulos.
 */

/** Custo-padrão em pontos por participante ACCEPTED (config inicial). */
export const CAMP_SUPPLY_COST_DEFAULT = 10;

/** Menor custo configurável pelo mestre (inteiro ≥ 1). */
export const CAMP_SUPPLY_COST_MIN = 1;

/** Maior custo configurável pelo mestre (limite superior razoável). */
export const CAMP_SUPPLY_COST_MAX = 1000;

/**
 * Categorias AMPLAS da exceção narrativa do mestre (`campSupplyOverride`).
 *
 * A ideia é registrar a INTENÇÃO sem engessar o roleplay: nada de enums
 * específicos como CAÇA/COLETA/BARGA/NPC/OURO/FAVOR — todos esses casos são
 * resolvidos dentro da ficção e cabem em `NARRATIVE`.
 *
 * - `NARRATIVE`: o mestre resolveu a falta de suprimentos dentro da ficção
 *   (caça, coleta, barganha, ajuda de NPC, ouro, favor, dívida...).
 * - `ADMINISTRATIVE`: o mestre simplesmente dispensou a exigência (mesa/teste).
 */
export const CAMP_SUPPLY_OVERRIDE_TYPES = ['NARRATIVE', 'ADMINISTRATIVE'] as const;

export type CampSupplyOverrideType = (typeof CAMP_SUPPLY_OVERRIDE_TYPES)[number];

/**
 * Limite de tamanho da nota OPCIONAL da exceção narrativa. Curta de propósito:
 * a justificativa existe para dar contexto à mesa, não para virar formulário.
 */
export const CAMP_SUPPLY_OVERRIDE_NOTE_MAX = 300;
