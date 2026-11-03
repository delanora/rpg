-- FASE 6.6C — SPELL SLOTS & CASTING RESOURCES.
--
-- Aditiva. NADA é recalculado em cima de dados antigos:
--   • spell_casts ganha o snapshot do RECURSO gasto (casts antigos ficam nulos);
--   • creatures/NPCs ganham o MÁXIMO declarado pelo statblock e o uso do template;
--   • combatants ganham o USO da INSTÂNCIA (duas cópias não compartilham gasto).
-- Personagens NÃO ganham tabela nova: o uso continua em characters.spells.

ALTER TABLE "spell_casts"
  ADD COLUMN "spellLevel" INTEGER,
  ADD COLUMN "castAtLevel" INTEGER,
  ADD COLUMN "castingResourceKind" TEXT,
  ADD COLUMN "castingResourceLevel" INTEGER,
  ADD COLUMN "castingResourceSourceId" TEXT,
  ADD COLUMN "resourceSpentAt" TIMESTAMP(3);

ALTER TABLE "creatures"
  ADD COLUMN "spellcastingResources" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "spellcastingUsed" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "combatants"
  ADD COLUMN "spellcastingUsed" JSONB NOT NULL DEFAULT '{}';
