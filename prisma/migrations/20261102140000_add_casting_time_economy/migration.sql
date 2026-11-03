-- FASE 6.6D — CASTING TIME & ACTION ECONOMY.
--
-- Aditiva. Combates antigos começam com turnSequence = 0 e passam a incrementar
-- na próxima ativação real de turno. SpellCasts antigos ficam com os campos
-- nulos (nada de backfill inventado); novos casts em combate sempre snapshottam
-- o casting time e a identidade de turno.

ALTER TABLE "combats"
  ADD COLUMN "turnSequence" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "spell_casts"
  ADD COLUMN "castingTimeKind" TEXT,
  ADD COLUMN "combatId" TEXT,
  ADD COLUMN "turnSequence" INTEGER,
  ADD COLUMN "combatantId" TEXT,
  ADD COLUMN "economyCostKind" TEXT,
  ADD COLUMN "economySpentAt" TIMESTAMP(3);

CREATE INDEX "spell_casts_combatId_turnSequence_combatantId_idx"
  ON "spell_casts"("combatId", "turnSequence", "combatantId");
