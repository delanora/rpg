-- Fase 6.6F — repertório explícito do statblock + INTENÇÃO de conjuração.
--
-- Aditiva: nenhuma coluna existente muda de tipo, nenhum dado é convertido.
-- O repertório do NPC nasce VAZIO (nada inferido por ND/CR): criaturas antigas
-- continuam sem conjurar até o Mestre declarar as magias do statblock.

-- Repertório EXPLÍCITO do statblock ({ spellIds: string[] }).
ALTER TABLE "creatures" ADD COLUMN "spellRepertoire" JSONB NOT NULL DEFAULT '{"spellIds":[]}';

-- Intenção de conjuração de PLAYER (pré-COMMIT).
CREATE TABLE "spell_cast_intents" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "casterEntityKind" TEXT NOT NULL,
    "casterEntityId" TEXT NOT NULL,
    "casterLabel" TEXT,
    "spellId" TEXT NOT NULL,
    "spellcastingSourceKind" TEXT,
    "spellcastingSourceId" TEXT,
    "castingResourceKind" TEXT,
    "castingResourceLevel" INTEGER,
    "targets" JSONB NOT NULL DEFAULT '[]',
    "requiredConfirmations" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "castOperationId" TEXT,
    "combatId" TEXT,
    "turnSequence" INTEGER,
    "combatantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "deniedBy" TEXT,
    "cancelledBy" TEXT,
    "spellCastId" TEXT,
    "reason" TEXT,

    CONSTRAINT "spell_cast_intents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "spell_cast_intents_operationId_key" ON "spell_cast_intents"("operationId");
CREATE INDEX "spell_cast_intents_status_createdAt_idx" ON "spell_cast_intents"("status", "createdAt");
CREATE INDEX "spell_cast_intents_casterEntityKind_casterEntityId_status_idx"
    ON "spell_cast_intents"("casterEntityKind", "casterEntityId", "status");

-- No máximo UMA intenção pendente por conjurador: barreira do BANCO (nunca Map
-- em memória). Aprovar/negar/cancelar libera a próxima.
CREATE UNIQUE INDEX "spell_cast_intents_one_pending_per_caster"
    ON "spell_cast_intents"("casterEntityKind", "casterEntityId")
    WHERE "status" = 'pending';
