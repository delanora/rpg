-- Regra OPCIONAL de Exaustão (PHB 2014): o Mestre liga/desliga por mesa.
--
-- O DEFAULT da coluna é `false`: uma CAMPANHA NOVA nasce sem a regra de
-- Exaustão. As mesas QUE JÁ EXISTIAM, porém, jogavam com Exaustão desde a Fase
-- 6.2 — então o backfill abaixo marca como `true` toda configuração presente
-- antes desta migration. Desligar passa a ser sempre uma decisão EXPLÍCITA do
-- Mestre, nunca um efeito silencioso sobre mesas em andamento.
--
-- Desligada, o nível salvo em cada ficha (`mechanicalState.exhaustionLevel`)
-- continua intacto e volta a valer se a regra for religada.

-- AlterTable
ALTER TABLE "game_config" ADD COLUMN "exhaustionEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: mesas existentes permanecem com a regra de Exaustão LIGADA.
UPDATE "game_config" SET "exhaustionEnabled" = true;
