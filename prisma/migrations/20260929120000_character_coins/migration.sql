-- Carteira de moedas da ficha e a chave "moedas extras" da mesa.
--
-- `coins` é um JSONB { pp, gp, ep, sp, cp } (inteiros >= 0). O backfill é
-- zerado: toda ficha existente nasce sem moeda. Só o mestre altera por PATCH;
-- o jogador gasta, troca e transfere pelos endpoints dedicados.
--
-- `extraCoins` liga a exibição das denominações PL (pp) e PE (ep) no bloco de
-- moedas — os valores das cinco denominações existem sempre no banco.

ALTER TABLE "characters"
  ADD COLUMN "coins" JSONB NOT NULL DEFAULT '{"pp":0,"gp":0,"ep":0,"sp":0,"cp":0}';

ALTER TABLE "game_config"
  ADD COLUMN "extraCoins" BOOLEAN NOT NULL DEFAULT false;
