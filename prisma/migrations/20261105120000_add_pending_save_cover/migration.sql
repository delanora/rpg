-- FASE 6.6J.5 — cobertura (Cover) por salvaguarda pendente.
-- Aditiva e opcional: pendências existentes continuam com NULL.
ALTER TABLE "pending_effect_saves" ADD COLUMN "cover" JSONB;
