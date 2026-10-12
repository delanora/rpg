-- AlterTable
ALTER TABLE "characters" ADD COLUMN     "deathState" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "combatants" ADD COLUMN     "deathState" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "death_operations" (
    "id" TEXT NOT NULL,
    "entityKind" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "death_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "death_operations_entityKind_entityId_operationId_key" ON "death_operations"("entityKind", "entityId", "operationId");

-- RenameIndex
ALTER INDEX "long_rest_camp_supply_contributions_requestId_inventoryItemId_k" RENAME TO "long_rest_camp_supply_contributions_requestId_inventoryItem_key";
