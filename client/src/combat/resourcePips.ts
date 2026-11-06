/**
 * GEMAS DE RECURSO DO TURNO (6.6M.5) — cálculo puro, sem React.
 *
 * A barra persistente representava Ação como texto (`1 / 1`). A gema é só
 * APRESENTAÇÃO do mesmo estado que já vem do servidor: nada aqui decide regra,
 * concede Ação Bônus nem soma recursos. Por isso a função não conhece
 * `TurnEconomy` — recebe os dois números e devolve o preenchimento.
 *
 * A ordem é a do consumo: as primeiras gemas são as já gastas (`false`) e as
 * seguintes as disponíveis (`true`), exatamente como o PHB descreve a Ação
 * extra (Action Surge) sendo consumida DEPOIS da primeira.
 */
export function actionPips(actionsGranted: number, actionsUsed: number): boolean[] {
  const granted = Number.isFinite(actionsGranted) ? Math.max(0, Math.floor(actionsGranted)) : 0;
  const used = Number.isFinite(actionsUsed) ? Math.max(0, Math.floor(actionsUsed)) : 0;
  return Array.from({ length: granted }, (_, index) => index >= used);
}

/**
 * Gema única (Ação Bônus / Reação): `true` = ainda não consumida.
 *
 * IMPORTANTE (PHB 2014): `true` significa apenas que o recurso NÃO FOI GASTO
 * neste turno. Não afirma que exista uma Ação Bônus executável agora — só uma
 * feature, magia ou outra regra concede uma. A UI continua dizendo isso no
 * próprio rótulo; a gema não inventa entitlement.
 */
export function singlePip(used: boolean): boolean {
  return !used;
}
