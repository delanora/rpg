-- Fase 6.5H — Hold Person (prova da engine Effect → Condition).
-- Tabela ADITIVA: nenhuma coluna existente é alterada.
CREATE TABLE "pending_effect_saves" (
    "id" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "groupId" TEXT,
    "effectId" TEXT,
    "casterEntityKind" TEXT NOT NULL,
    "casterEntityId" TEXT NOT NULL,
    "targetEntityKind" TEXT NOT NULL,
    "targetEntityId" TEXT NOT NULL,
    "ability" TEXT NOT NULL,
    "dc" INTEGER NOT NULL,
    "casterLabel" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" TEXT,
    "operationId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "pending_effect_saves_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pending_effect_saves_operationId_key" ON "pending_effect_saves"("operationId");
CREATE INDEX "pending_effect_saves_targetEntityKind_targetEntityId_status_idx" ON "pending_effect_saves"("targetEntityKind", "targetEntityId", "status");
CREATE INDEX "pending_effect_saves_casterEntityKind_casterEntityId_status_idx" ON "pending_effect_saves"("casterEntityKind", "casterEntityId", "status");
