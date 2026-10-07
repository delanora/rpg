-- CreateEnum
CREATE TYPE "LongRestStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LongRestRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LongRestResponse" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateTable
CREATE TABLE "long_rest_sessions" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "longRestRequestId" TEXT,
    "status" "LongRestStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "long_rest_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "long_rest_requests" (
    "id" TEXT NOT NULL,
    "status" "LongRestRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "forcedByUserId" TEXT,

    CONSTRAINT "long_rest_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "long_rest_request_participants" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "response" "LongRestResponse" NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMP(3),
    "closedByMaster" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "long_rest_request_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "long_rest_operations" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "result" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "long_rest_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "long_rest_sessions_status_idx" ON "long_rest_sessions"("status");

-- CreateIndex
CREATE INDEX "long_rest_sessions_characterId_status_idx" ON "long_rest_sessions"("characterId", "status");

-- CreateIndex
CREATE INDEX "long_rest_sessions_longRestRequestId_idx" ON "long_rest_sessions"("longRestRequestId");

-- CreateIndex
CREATE INDEX "long_rest_requests_status_idx" ON "long_rest_requests"("status");

-- CreateIndex
CREATE INDEX "long_rest_request_participants_requestId_idx" ON "long_rest_request_participants"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "long_rest_request_participants_requestId_userId_key" ON "long_rest_request_participants"("requestId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "long_rest_operations_operationId_key" ON "long_rest_operations"("operationId");

-- AddForeignKey
ALTER TABLE "long_rest_sessions" ADD CONSTRAINT "long_rest_sessions_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "long_rest_sessions" ADD CONSTRAINT "long_rest_sessions_longRestRequestId_fkey" FOREIGN KEY ("longRestRequestId") REFERENCES "long_rest_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "long_rest_requests" ADD CONSTRAINT "long_rest_requests_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "long_rest_requests" ADD CONSTRAINT "long_rest_requests_forcedByUserId_fkey" FOREIGN KEY ("forcedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "long_rest_request_participants" ADD CONSTRAINT "long_rest_request_participants_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "long_rest_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "long_rest_request_participants" ADD CONSTRAINT "long_rest_request_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "long_rest_request_participants" ADD CONSTRAINT "long_rest_request_participants_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Apenas UMA solicitação coletiva de Descanso Longo PENDING no mundo (mesa
-- global única), garantida pelo BANCO (índice único parcial) — mesmo padrão de
-- "short_rest_requests_one_pending_key" e "combats_one_active_key".
CREATE UNIQUE INDEX "long_rest_requests_one_pending_key"
    ON "long_rest_requests" ((1))
    WHERE "status" = 'PENDING';

-- Apenas UMA sessão de Descanso Longo ATIVA por personagem, garantida pelo
-- BANCO (índice único parcial). Mesmo padrão de "short_rest_sessions_one_active_key".
CREATE UNIQUE INDEX "long_rest_sessions_one_active_key"
    ON "long_rest_sessions" ("characterId")
    WHERE "status" = 'ACTIVE';
