-- FASE 6.6J.3 — colocação e snapshot de ÁREA na intenção de conjuração.
--
-- Aditiva e opcional: magias de alvo explícito (e intenções já existentes)
-- continuam com NULL, exatamente como antes.
ALTER TABLE "spell_cast_intents" ADD COLUMN "areaPlacement" JSONB;
ALTER TABLE "spell_cast_intents" ADD COLUMN "areaSnapshot" JSONB;
