-- Assistente de criação de personagem.
--
-- 1. `characters.creationDraft` guarda o RASCUNHO do assistente (modo escolhido,
--    passo alcançado, as rolagens de 4d6 e os valores-base dos atributos). O
--    rascunho é o próprio registro do personagem enquanto
--    `creationFinalized` for falso.
-- 2. `game_config.startingLevel` é o nível em que a mesa começa: quando for
--    maior que 1, o assistente aplica os níveis 2 até ele ao concluir a
--    montagem, sem depender da liberação de Level Up do mestre.

ALTER TABLE "game_config" ADD COLUMN "startingLevel" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "characters" ADD COLUMN "creationDraft" JSONB NOT NULL DEFAULT '{}';
