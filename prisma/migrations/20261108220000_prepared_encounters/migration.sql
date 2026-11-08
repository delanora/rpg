CREATE TABLE "prepared_encounters" (
 "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "preparation" JSONB NOT NULL,
 "version" INTEGER NOT NULL DEFAULT 0, "deletedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "prepared_encounter_operations" (
 "id" TEXT NOT NULL PRIMARY KEY, "encounterId" TEXT NOT NULL,
 "operationId" TEXT NOT NULL, "fingerprint" TEXT NOT NULL, "snapshot" JSONB NOT NULL,
 CONSTRAINT "prepared_encounter_operations_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "prepared_encounters"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "prepared_encounter_operations_encounterId_operationId_key" ON "prepared_encounter_operations"("encounterId", "operationId");
