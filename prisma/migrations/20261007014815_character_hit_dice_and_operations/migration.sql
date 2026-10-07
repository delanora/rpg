-- AlterTable
ALTER TABLE "characters" ADD COLUMN     "hitDice" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "character_operations" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "result" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "character_operations_characterId_operationId_key" ON "character_operations"("characterId", "operationId");

-- AddForeignKey
ALTER TABLE "character_operations" ADD CONSTRAINT "character_operations_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
