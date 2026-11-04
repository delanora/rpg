-- FASE 6.6G — componentes V/S/M no histórico da conjuração.
--
-- Aditiva e nullable: casts anteriores continuam válidos sem snapshot, e nada é
-- retroativamente inventado (não sabemos que foco foi usado antes da regra).
ALTER TABLE "spell_casts" ADD COLUMN "componentsSnapshot" JSONB;
