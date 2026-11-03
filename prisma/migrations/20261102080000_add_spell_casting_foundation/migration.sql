-- Fase 6.6A — Casting Foundation & Spell Resolution Contract.
-- Migration ADITIVA: nenhuma coluna/tabela existente é alterada ou removida.

-- EVENTO de conjuração (identidade de domínio; histórico/auditoria).
CREATE TABLE "spell_casts" (
    "id" TEXT NOT NULL,
    "spellId" TEXT NOT NULL,
    "casterEntityKind" TEXT NOT NULL,
    "casterEntityId" TEXT NOT NULL,
    "casterLabel" TEXT,
    "targets" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'resolving',
    "outcome" TEXT,
    "requiresConcentration" BOOLEAN NOT NULL DEFAULT false,
    "effectGroupId" TEXT,
    "saveDc" INTEGER,
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "operationId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "spell_casts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "spell_casts_operationId_key" ON "spell_casts"("operationId");
CREATE INDEX "spell_casts_casterEntityKind_casterEntityId_status_idx" ON "spell_casts"("casterEntityKind", "casterEntityId", "status");
CREATE INDEX "spell_casts_spellId_idx" ON "spell_casts"("spellId");
CREATE INDEX "spell_casts_effectGroupId_idx" ON "spell_casts"("effectGroupId");

-- UM cast RESOLVING por caster: a barreira é do BANCO (não de memória do
-- processo) e libera sozinha quando o cast vira resolved/cancelled.
CREATE UNIQUE INDEX "spell_casts_one_resolving_per_caster"
    ON "spell_casts"("casterEntityKind", "casterEntityId")
    WHERE "status" = 'resolving';

-- Vínculo explícito pendência → conjuração (nullable: pendências antigas
-- continuam válidas e resolvíveis).
ALTER TABLE "pending_effect_saves" ADD COLUMN "spellCastId" TEXT;
CREATE INDEX "pending_effect_saves_spellCastId_idx" ON "pending_effect_saves"("spellCastId");
