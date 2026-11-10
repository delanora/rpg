ALTER TABLE "combatants" ADD COLUMN "elevationFeet" DOUBLE PRECISION, ADD COLUMN "bodyHeightFeet" DOUBLE PRECISION;
CREATE TABLE "elevation_requests" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "combatId" TEXT NOT NULL REFERENCES "combats"("id") ON DELETE CASCADE,
  "combatantId" TEXT NOT NULL REFERENCES "combatants"("id") ON DELETE CASCADE,
  "requesterId" TEXT NOT NULL,
  "turnSequence" INTEGER NOT NULL,
  "origin" JSONB NOT NULL,
  "path" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "elevation_requests_combatId_status_idx" ON "elevation_requests"("combatId", "status");
