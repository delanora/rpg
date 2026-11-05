-- Fase 6.6L.3.1 — Movement Reaction Gate / Opportunity Attack Trigger.
-- Duas tabelas ADITIVAS: nada do que já existe muda de significado.
--   movement_intents      → movimento pausado (checkpoint + caminho restante);
--   reaction_opportunities → janela de Reação persistida por reactor.

CREATE TABLE "movement_intents" (
    "id" TEXT NOT NULL,
    "combatId" TEXT NOT NULL,
    "combatantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending-reaction',
    "checkpoint" JSONB,
    "remainingPath" JSONB NOT NULL DEFAULT '[]',
    "committedCostFeet" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "committedDistanceFeet" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reason" TEXT,
    "operationId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "movement_intents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reaction_opportunities" (
    "id" TEXT NOT NULL,
    "combatId" TEXT NOT NULL,
    "movementIntentId" TEXT,
    "moverCombatantId" TEXT NOT NULL,
    "reactorCombatantId" TEXT NOT NULL,
    "reactorUserId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'opportunity-attack',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "boundaryIndex" INTEGER NOT NULL DEFAULT 0,
    "reachFeet" DOUBLE PRECISION NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "visibilityStatus" TEXT NOT NULL DEFAULT 'known-visible',
    "visibilityConfirmedBy" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "resolution" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reaction_opportunities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "movement_intents_combatId_operationId_key"
    ON "movement_intents"("combatId", "operationId");
CREATE INDEX "movement_intents_combatId_status_idx"
    ON "movement_intents"("combatId", "status");
CREATE INDEX "reaction_opportunities_combatId_status_idx"
    ON "reaction_opportunities"("combatId", "status");
CREATE INDEX "reaction_opportunities_combatId_movementIntentId_idx"
    ON "reaction_opportunities"("combatId", "movementIntentId");

ALTER TABLE "movement_intents"
    ADD CONSTRAINT "movement_intents_combatId_fkey"
    FOREIGN KEY ("combatId") REFERENCES "combats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reaction_opportunities"
    ADD CONSTRAINT "reaction_opportunities_combatId_fkey"
    FOREIGN KEY ("combatId") REFERENCES "combats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reaction_opportunities"
    ADD CONSTRAINT "reaction_opportunities_movementIntentId_fkey"
    FOREIGN KEY ("movementIntentId") REFERENCES "movement_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
