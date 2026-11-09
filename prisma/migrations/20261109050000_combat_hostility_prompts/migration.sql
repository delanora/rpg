-- Relações particulares não mudam os lados globais do encontro.
ALTER TABLE "combatants" ADD COLUMN "hostileToIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE TABLE "combat_hostility_prompts" (
  "id" TEXT NOT NULL,
  "combatId" TEXT NOT NULL,
  "attackerId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "npcId" TEXT NOT NULL,
  "attackName" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "selectedIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "combat_hostility_prompts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "combat_hostility_prompts_combatId_fkey" FOREIGN KEY ("combatId") REFERENCES "combats"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "combat_hostility_prompts_combatId_eventId_npcId_key" ON "combat_hostility_prompts"("combatId", "eventId", "npcId");
CREATE INDEX "combat_hostility_prompts_combatId_status_idx" ON "combat_hostility_prompts"("combatId", "status");
