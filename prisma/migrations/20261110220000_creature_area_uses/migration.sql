CREATE TABLE "creature_area_uses" (
 "id" TEXT NOT NULL, "combatId" TEXT NOT NULL, "casterEntityKind" TEXT NOT NULL,
 "casterEntityId" TEXT NOT NULL, "casterLabel" TEXT NOT NULL, "abilityId" TEXT NOT NULL,
 "label" TEXT NOT NULL, "definition" JSONB NOT NULL, "placement" JSONB NOT NULL,
 "targets" JSONB NOT NULL, "visibility" TEXT NOT NULL DEFAULT 'public',
 "status" TEXT NOT NULL DEFAULT 'resolving', "outcome" TEXT, "resolutionSnapshot" JSONB,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "resolvedAt" TIMESTAMP(3),
 CONSTRAINT "creature_area_uses_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "creature_area_uses_combatId_fkey" FOREIGN KEY ("combatId") REFERENCES "combats"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "creature_area_uses_combatId_status_idx" ON "creature_area_uses"("combatId","status");
ALTER TABLE "pending_effect_saves" ADD COLUMN "creatureAreaUseId" TEXT, ADD COLUMN "sourceLabel" TEXT;
ALTER TABLE "pending_effect_saves" ADD CONSTRAINT "pending_effect_saves_creatureAreaUseId_fkey" FOREIGN KEY ("creatureAreaUseId") REFERENCES "creature_area_uses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "pending_effect_saves_creatureAreaUseId_status_idx" ON "pending_effect_saves"("creatureAreaUseId","status");
CREATE UNIQUE INDEX "pending_area_use_target_key" ON "pending_effect_saves"("creatureAreaUseId","targetEntityKind","targetEntityId");
