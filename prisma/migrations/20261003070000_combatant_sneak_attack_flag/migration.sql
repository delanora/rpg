-- Trava do Ataque Furtivo: uma vez por turno. Zerada quando o turno do
-- combatente começa (nextTurn).
ALTER TABLE "combatants" ADD COLUMN "sneakAttackUsedThisTurn" BOOLEAN NOT NULL DEFAULT false;
