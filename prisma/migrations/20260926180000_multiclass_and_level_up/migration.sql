-- Multiclasse: a classe única vira uma lista de entradas
-- ({ classKey, subclass, level }) e a configuração da mesa ganha o controle de
-- Level Up liberado pelo mestre.

CREATE TABLE "game_config" (
  "id"              TEXT         NOT NULL,
  "levelUpUnlocked" BOOLEAN      NOT NULL DEFAULT false,
  "levelUpRelease"  INTEGER      NOT NULL DEFAULT 0,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "game_config_pkey" PRIMARY KEY ("id")
);

-- Linha única da mesa.
INSERT INTO "game_config" ("id", "levelUpUnlocked", "levelUpRelease", "updatedAt")
VALUES ('main', false, 0, CURRENT_TIMESTAMP);

ALTER TABLE "characters" ADD COLUMN "classes" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "characters" ADD COLUMN "lastLevelUpRelease" INTEGER NOT NULL DEFAULT 0;

-- Converte a classe única em uma entrada da lista (fichas sem classe seguem vazias).
UPDATE "characters"
SET "classes" = jsonb_build_array(
  jsonb_build_object(
    'classKey', "classKey",
    'subclass', "subclass",
    'level', "level"
  )
)
WHERE "classKey" <> '';

-- `classes` passa a ser a fonte de verdade: as colunas antigas saem.
ALTER TABLE "characters" DROP COLUMN "className";
ALTER TABLE "characters" DROP COLUMN "classKey";
ALTER TABLE "characters" DROP COLUMN "subclass";
ALTER TABLE "characters" DROP COLUMN "level";
