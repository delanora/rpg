-- Criação finalizada e Classe de Armadura automática.
--
-- 1. `creationFinalized` separa a MONTAGEM do personagem do ESTADO DE JOGO:
--    com a criação encerrada, o jogador só mexe em PV atual/temporário, usos
--    de recursos e espaços de magia, anotações, avatar e movimentação de itens.
--    As fichas que já existem foram criadas e não devem passar pelo fluxo de
--    criação de novo, então entram já finalizadas.
ALTER TABLE "characters" ADD COLUMN "creationFinalized" BOOLEAN NOT NULL DEFAULT false;

UPDATE "characters" SET "creationFinalized" = true;

-- 2. A CA passa a ser calculada (armadura equipada + atributos + defesa sem
--    armadura) e a coluna guarda apenas o OVERRIDE manual do mestre:
--    `0` = sem override (cálculo automático).
ALTER TABLE "characters" ALTER COLUMN "armorClass" SET DEFAULT 0;

-- As fichas antigas tinham um valor manual digitado pelo jogador (não um
-- override do mestre), então voltam ao automático. O mestre pode definir um
-- override a qualquer momento pelo campo da ficha.
UPDATE "characters" SET "armorClass" = 0;
