CREATE TABLE "combat_duels" (
  "id" TEXT NOT NULL,
  "combatId" TEXT NOT NULL,
  "requesterId" TEXT NOT NULL,
  "challengedId" TEXT NOT NULL,
  "pairKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "combat_duels_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "combat_duels_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "combatants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "combat_duels_challengedId_fkey" FOREIGN KEY ("challengedId") REFERENCES "combatants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "combat_duels_combatId_fkey" FOREIGN KEY ("combatId") REFERENCES "combats"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "combat_duels_combatId_status_idx" ON "combat_duels"("combatId", "status");
-- Histórico permanece; somente uma solicitação/duelo aberto por par.
CREATE UNIQUE INDEX "combat_duels_open_pair_key" ON "combat_duels"("combatId", "pairKey") WHERE "status" IN ('pending', 'active');
