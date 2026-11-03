-- Fase 6.6B — Spellcasting Ability, Spell Save DC & Spell Attack Bonus.
-- Migration ADITIVA: nenhuma coluna/tabela existente é alterada ou removida, e
-- nenhum cast antigo é reescrito (as colunas novas começam NULL).

-- SNAPSHOT do perfil de conjuração no evento de conjuração. O cast histórico
-- NUNCA é recalculado a partir da ficha/statblock atual.
ALTER TABLE "spell_casts" ADD COLUMN "spellcastingSourceKind" TEXT;
ALTER TABLE "spell_casts" ADD COLUMN "spellcastingSourceId" TEXT;
ALTER TABLE "spell_casts" ADD COLUMN "spellcastingSourceLabel" TEXT;
ALTER TABLE "spell_casts" ADD COLUMN "spellcastingMode" TEXT;
ALTER TABLE "spell_casts" ADD COLUMN "spellcastingAbility" TEXT;
ALTER TABLE "spell_casts" ADD COLUMN "spellcastingAbilityScore" INTEGER;
ALTER TABLE "spell_casts" ADD COLUMN "spellcastingAbilityModifier" INTEGER;
ALTER TABLE "spell_casts" ADD COLUMN "spellcastingProficiencyBonus" INTEGER;
ALTER TABLE "spell_casts" ADD COLUMN "spellSaveDc" INTEGER;
ALTER TABLE "spell_casts" ADD COLUMN "spellAttackBonus" INTEGER;

-- PERFIL DE CONJURAÇÃO do statblock de criaturas/NPCs. Valores explícitos
-- (`saveDc`/`attackBonus`/`ability`); vazio = criatura sem conjuração.
ALTER TABLE "creatures" ADD COLUMN "spellcastingProfile" JSONB NOT NULL DEFAULT '{}';
