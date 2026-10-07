-- CreateEnum
CREATE TYPE "ShortRestStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "character_operations" ADD COLUMN     "shortRestSessionId" TEXT;

-- CreateTable
CREATE TABLE "short_rest_sessions" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "status" "ShortRestStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "short_rest_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "short_rest_sessions_status_idx" ON "short_rest_sessions"("status");

-- CreateIndex
CREATE INDEX "short_rest_sessions_characterId_status_idx" ON "short_rest_sessions"("characterId", "status");

-- CreateIndex
CREATE INDEX "character_operations_shortRestSessionId_idx" ON "character_operations"("shortRestSessionId");

-- AddForeignKey
ALTER TABLE "character_operations" ADD CONSTRAINT "character_operations_shortRestSessionId_fkey" FOREIGN KEY ("shortRestSessionId") REFERENCES "short_rest_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "short_rest_sessions" ADD CONSTRAINT "short_rest_sessions_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Apenas UMA sessão de Descanso Curto ATIVA por personagem, garantida pelo
-- BANCO (índice único parcial). O Prisma não modela índice parcial, então entra
-- como SQL direto — mesmo padrão de "combats_one_active_key".
CREATE UNIQUE INDEX "short_rest_sessions_one_active_key"
    ON "short_rest_sessions" ("characterId")
    WHERE "status" = 'ACTIVE';
