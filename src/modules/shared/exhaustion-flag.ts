/**
 * Espelho EM MEMÓRIA da configuração da mesa "Usar regra de Exaustão".
 *
 * A regra de Exaustão do PHB 2014 é OPCIONAL na mesa: o Mestre liga/desliga em
 * `GameConfig.exhaustionEnabled` (a fonte de verdade, persistida no banco).
 * Como as derivações mecânicas (`deriveConditionEffects`, `effectiveSpeed`,
 * `effectiveMaxHp`, ...) são funções puras e SÍNCRONAS — usadas dentro de DTOs
 * síncronos —, elas não podem consultar o banco. Este módulo é o único ponto
 * onde o valor persistido é espelhado para leitura síncrona.
 *
 * Regras deste espelho:
 *  - o service de configuração reescreve o valor a cada leitura/escrita da
 *    configuração (`toGameConfigDto`) e no boot do servidor;
 *  - o padrão, antes de qualquer leitura, é `true`: ligada. É o comportamento
 *    histórico das mesas existentes (a migration faz o backfill para `true`) e
 *    falha para o lado seguro, nunca desligando a regra silenciosamente;
 *  - o valor SALVO por personagem/criatura nunca é apagado — desligar a regra
 *    só torna o nível de Exaustão mecanicamente inerte.
 */
let enabled = true;

/** Verdadeiro quando a mesa usa a regra de Exaustão (PHB 2014). */
export function exhaustionRuleEnabled(): boolean {
  return enabled;
}

/**
 * Atualiza o espelho. Chamado pelo service de configuração (após ler/gravar a
 * linha única) e pelo smoke, que testa as derivações puras localmente.
 */
export function setExhaustionRuleEnabled(value: boolean): void {
  enabled = value;
}
