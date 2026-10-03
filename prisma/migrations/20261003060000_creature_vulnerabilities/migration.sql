-- A7 — vulnerabilidade por tipo de dano para CRIATURAS (dano dobrado).
--
-- Antes só existiam `resistances` (metade) e `immunities` (zero). Sem
-- vulnerabilidade o sistema de resistências fica pela metade. Os valores são os
-- 13 tipos canônicos de shared/attacks.ts, validados na aplicação (Zod).
ALTER TABLE "creatures" ADD COLUMN "vulnerabilities" JSONB NOT NULL DEFAULT '[]';
