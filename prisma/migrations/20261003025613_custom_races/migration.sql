-- AlterTable
ALTER TABLE "characters" ADD COLUMN     "darkvision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "raceResistances" TEXT[] DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "speed" SET DEFAULT 9;

-- AlterTable
ALTER TABLE "creatures" ALTER COLUMN "speed" SET DEFAULT 9;

-- AlterTable
ALTER TABLE "game_config" ALTER COLUMN "id" SET DEFAULT 'main';

-- CreateTable
CREATE TABLE "custom_races" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "abilityScoreIncrease" JSONB NOT NULL DEFAULT '[]',
    "speed" INTEGER NOT NULL DEFAULT 9,
    "size" TEXT NOT NULL DEFAULT 'Medium',
    "darkvision" INTEGER NOT NULL DEFAULT 0,
    "damageResistances" JSONB NOT NULL DEFAULT '[]',
    "languages" JSONB NOT NULL DEFAULT '[]',
    "bonusLanguageChoices" INTEGER NOT NULL DEFAULT 0,
    "traits" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_races_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "custom_races_name_idx" ON "custom_races"("name");

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_customRaceId_fkey" FOREIGN KEY ("customRaceId") REFERENCES "custom_races"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Migração de dados (Prompt 2.10)
-- As fichas antigas gravavam a raça em TEXTO LIVRE; a partir de agora a raça
-- vem do catálogo estruturado (`raceId`/`subraceId`) ou das raças personalizadas
-- do mestre. As fichas com `race` em texto livre são removidas (decisão do
-- projeto). Combatentes em combate ficam com `characterId` nulo (SET NULL), sem
-- quebrar a ordem dos turnos.
DELETE FROM "characters" WHERE "race" <> '';
