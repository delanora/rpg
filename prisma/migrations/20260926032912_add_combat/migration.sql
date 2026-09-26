-- CreateEnum
CREATE TYPE "CombatStatus" AS ENUM ('PENDING_INITIATIVE', 'ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "CombatantKind" AS ENUM ('CHARACTER', 'CREATURE');

-- CreateTable
CREATE TABLE "combats" (
    "id" TEXT NOT NULL,
    "status" "CombatStatus" NOT NULL DEFAULT 'PENDING_INITIATIVE',
    "round" INTEGER NOT NULL DEFAULT 1,
    "currentIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "combats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "combatants" (
    "id" TEXT NOT NULL,
    "combatId" TEXT NOT NULL,
    "kind" "CombatantKind" NOT NULL,
    "characterId" TEXT,
    "creatureId" TEXT,
    "name" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "dexterityMod" INTEGER NOT NULL DEFAULT 0,
    "initiative" INTEGER,
    "initiativeRoll" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "combatants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "combats_status_idx" ON "combats"("status");

-- CreateIndex
CREATE INDEX "combatants_combatId_idx" ON "combatants"("combatId");

-- CreateIndex
CREATE INDEX "combatants_ownerUserId_idx" ON "combatants"("ownerUserId");

-- AddForeignKey
ALTER TABLE "combatants" ADD CONSTRAINT "combatants_combatId_fkey" FOREIGN KEY ("combatId") REFERENCES "combats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combatants" ADD CONSTRAINT "combatants_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combatants" ADD CONSTRAINT "combatants_creatureId_fkey" FOREIGN KEY ("creatureId") REFERENCES "creatures"("id") ON DELETE SET NULL ON UPDATE CASCADE;
