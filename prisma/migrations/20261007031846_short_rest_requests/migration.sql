-- CreateEnum
CREATE TYPE "ShortRestRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShortRestResponse" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateTable
CREATE TABLE "short_rest_requests" (
    "id" TEXT NOT NULL,
    "status" "ShortRestRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "forcedByUserId" TEXT,

    CONSTRAINT "short_rest_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "short_rest_request_participants" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "response" "ShortRestResponse" NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMP(3),
    "closedByMaster" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "short_rest_request_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "short_rest_operations" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "result" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "short_rest_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "short_rest_requests_status_idx" ON "short_rest_requests"("status");

-- CreateIndex
CREATE INDEX "short_rest_request_participants_requestId_idx" ON "short_rest_request_participants"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "short_rest_request_participants_requestId_userId_key" ON "short_rest_request_participants"("requestId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "short_rest_operations_operationId_key" ON "short_rest_operations"("operationId");

-- AddForeignKey
ALTER TABLE "short_rest_requests" ADD CONSTRAINT "short_rest_requests_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "short_rest_requests" ADD CONSTRAINT "short_rest_requests_forcedByUserId_fkey" FOREIGN KEY ("forcedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "short_rest_request_participants" ADD CONSTRAINT "short_rest_request_participants_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "short_rest_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "short_rest_request_participants" ADD CONSTRAINT "short_rest_request_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "short_rest_request_participants" ADD CONSTRAINT "short_rest_request_participants_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Apenas UMA solicitação coletiva PENDING no mundo (mesa global única),
-- garantida pelo BANCO (índice único parcial) — mesmo padrão de
-- "combats_one_active_key".
CREATE UNIQUE INDEX "short_rest_requests_one_pending_key"
    ON "short_rest_requests" ((1))
    WHERE "status" = 'PENDING';
