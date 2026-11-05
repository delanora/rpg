-- Fase 6.6L.1 — fundação espacial (aditiva).
--
-- `Combat.spatialConfig`: cena espacial (modo/dimensões/célula). NULL = cena
-- assistida padrão (nenhum combate existente muda de comportamento).
-- `Combatant.spatialPosition`: âncora 2D em PÉS da INSTÂNCIA do combate.
--   NULL = UNPLACED (nunca 0,0). A posição não existe na ficha nem no template.
-- `Creature.size`: tamanho mecânico do statblock, definido pelo Mestre.
--   Registros legados recebem 'Medium' de forma EXPLÍCITA (dívida relatada).

ALTER TABLE "combats" ADD COLUMN "spatialConfig" JSONB;

ALTER TABLE "combatants" ADD COLUMN "spatialPosition" JSONB;

ALTER TABLE "creatures" ADD COLUMN "size" TEXT NOT NULL DEFAULT 'Medium';
