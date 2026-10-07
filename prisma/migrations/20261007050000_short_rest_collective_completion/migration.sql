-- O descanso coletivo passa a ter um estado de TERMINADO (não basta APPROVED,
-- que significa "em andamento").
ALTER TYPE "ShortRestRequestStatus" ADD VALUE 'COMPLETED';

-- AlterTable: vínculo persistente da sessão individual com a solicitação
-- coletiva + estado de prontidão do participante.
ALTER TABLE "short_rest_sessions"
    ADD COLUMN "shortRestRequestId" TEXT,
    ADD COLUMN "readyAt" TIMESTAMP(3);

-- AlterTable: quando o descanso coletivo terminou.
ALTER TABLE "short_rest_requests"
    ADD COLUMN "completedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "short_rest_sessions_shortRestRequestId_idx" ON "short_rest_sessions"("shortRestRequestId");

-- AddForeignKey
ALTER TABLE "short_rest_sessions" ADD CONSTRAINT "short_rest_sessions_shortRestRequestId_fkey" FOREIGN KEY ("shortRestRequestId") REFERENCES "short_rest_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
