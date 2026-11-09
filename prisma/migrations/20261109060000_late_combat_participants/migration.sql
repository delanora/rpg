ALTER TABLE "combats" ADD COLUMN "extraTurnResumeAfterId" TEXT;
ALTER TABLE "combatants" ADD COLUMN "firstTurnPending" BOOLEAN NOT NULL DEFAULT false;
