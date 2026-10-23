-- O MESMO NPC persistente só pode entrar UMA vez no combate.
--
-- A regra não vale para criaturas-template: `kind = 'CREATURE'` continua
-- podendo gerar Goblin 1, Goblin 2, Goblin 3 — cada cópia com o próprio
-- Combatant. Por isso o índice é PARCIAL em `kind = 'NPC'`.
--
-- A checagem em `startCombat` (409 com mensagem clara) é só o caminho rápido;
-- este índice garante a unicidade no banco mesmo numa corrida/duplo clique.
CREATE UNIQUE INDEX "combatants_one_npc_per_combat"
  ON "combatants" ("combatId", "creatureId")
  WHERE "kind" = 'NPC';
