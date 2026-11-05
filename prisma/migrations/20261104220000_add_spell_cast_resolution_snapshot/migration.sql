-- FASE 6.6I.3: snapshot imutável da resolução IMEDIATA da magia (cura).
-- Aditivo: casts antigos ficam NULL e continuam legíveis sem recálculo.
ALTER TABLE "spell_casts" ADD COLUMN "resolutionSnapshot" JSONB;
