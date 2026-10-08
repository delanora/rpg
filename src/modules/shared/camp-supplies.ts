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
