-- Fundação dos RECURSOS RACIAIS (PHB 2014): estado de usos SEPARADO do classState.
--
-- ADITIVA: só adiciona a coluna com default seguro. O MÁXIMO e a RECARGA de cada
-- recurso são DERIVADOS do catálogo (src/modules/shared/races/resources.ts) e não
-- são persistidos. Fichas existentes já nascem com { used: {} } (nenhum uso gasto),
-- então não há backfill a fazer.

ALTER TABLE "characters"
    ADD COLUMN "racialState" JSONB NOT NULL DEFAULT '{}';
