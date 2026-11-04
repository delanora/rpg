-- FASE 6.6E — TARGETING & RANGE ASSISTIDO (aditiva).
--
-- 1) Snapshot imutável da validação de alvos em cada conjuração: quantidade,
--    máximo DERIVADO do espaço, alcance em pés, filtros e evidência espacial.
-- 2) Uma conjuração pode ter N pendências (um save por alvo) — o índice garante
--    UMA pendência por alvo/cast mesmo sob retry/concorrência, e o índice por
--    (spellCastId, status) atende o finalizer da resolution barrier.
ALTER TABLE "spell_casts" ADD COLUMN "targetingSnapshot" JSONB;

CREATE INDEX "pending_effect_saves_spellCastId_status_idx"
  ON "pending_effect_saves"("spellCastId", "status");

CREATE UNIQUE INDEX "pending_effect_saves_spellCastId_targetEntityKind_targetEntityId_key"
  ON "pending_effect_saves"("spellCastId", "targetEntityKind", "targetEntityId");
