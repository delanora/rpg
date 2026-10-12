-- AlterTable
ALTER TABLE "characters" ADD COLUMN     "mechanicalState" JSONB NOT NULL DEFAULT '{"conditions":[],"exhaustionLevel":0,"log":[]}';

-- AlterTable
ALTER TABLE "creatures" ADD COLUMN     "mechanicalState" JSONB NOT NULL DEFAULT '{"conditions":[],"exhaustionLevel":0,"log":[]}';

-- AlterTable
ALTER TABLE "combatants" ADD COLUMN     "mechanicalState" JSONB NOT NULL DEFAULT '{"conditions":[],"exhaustionLevel":0,"log":[]}',
ADD COLUMN     "mechanicalVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "mechanical_operations" (
    "id" TEXT NOT NULL,
    "entityKind" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mechanical_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mechanical_operations_entityKind_entityId_operationId_key" ON "mechanical_operations"("entityKind", "entityId", "operationId");
