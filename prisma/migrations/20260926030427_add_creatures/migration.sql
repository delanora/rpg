-- CreateTable
CREATE TABLE "creatures" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT '',
    "challengeRating" TEXT NOT NULL DEFAULT '',
    "strength" INTEGER NOT NULL DEFAULT 10,
    "dexterity" INTEGER NOT NULL DEFAULT 10,
    "constitution" INTEGER NOT NULL DEFAULT 10,
    "intelligence" INTEGER NOT NULL DEFAULT 10,
    "wisdom" INTEGER NOT NULL DEFAULT 10,
    "charisma" INTEGER NOT NULL DEFAULT 10,
    "hpCurrent" INTEGER NOT NULL DEFAULT 1,
    "hpMax" INTEGER NOT NULL DEFAULT 1,
    "armorClass" INTEGER NOT NULL DEFAULT 10,
    "speed" INTEGER NOT NULL DEFAULT 30,
    "attacks" JSONB NOT NULL DEFAULT '[]',
    "resistances" JSONB NOT NULL DEFAULT '[]',
    "immunities" JSONB NOT NULL DEFAULT '[]',
    "description" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creatures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "creatures_name_idx" ON "creatures"("name");
