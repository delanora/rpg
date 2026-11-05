-- FASE 6.6I.2 — snapshot tipado da resolução de `save-damage`.
-- Aditiva: pendências de efeito contínuo/legadas ficam com NULL e seguem iguais.
ALTER TABLE "pending_effect_saves" ADD COLUMN "resolutionSnapshot" JSONB;
