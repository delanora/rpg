-- Fase 6.6L.3 — lado (side) do ENCONTRO (aditiva).
--
-- `Combatant.sideKey`: lado definido pelo Mestre para decidir hostilidade.
--   NULL = relação DESCONHECIDA: o motor de movimento nunca infere
--   aliado/inimigo a partir do tipo de entidade (Character/Creature/NPC).
--   Combates legados ficam NULL e não são classificados automaticamente.
--   Vive só na instância do combate: a ficha global e o template da criatura
--   NÃO recebem lado (a mesma criatura pode estar em lados diferentes em
--   encontros diferentes).

ALTER TABLE "combatants" ADD COLUMN "sideKey" TEXT;
