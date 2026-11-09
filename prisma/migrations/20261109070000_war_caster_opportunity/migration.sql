ALTER TABLE "reaction_opportunities" ADD COLUMN "spellCastId" TEXT;
CREATE UNIQUE INDEX "reaction_opportunities_spellCastId_key" ON "reaction_opportunities"("spellCastId");
