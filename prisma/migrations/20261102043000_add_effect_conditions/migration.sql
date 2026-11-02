-- FASE 6.5C — Conditions aplicadas por uma instância de efeito.
--
-- ADITIVO e não destrutivo: efeitos existentes ficam com a lista vazia, ou
-- seja, continuam sem aplicar Condition nenhuma (comportamento da 6.5B).
-- As instâncias reais vivem em `mechanicalState.conditions[]` (JSON do alvo),
-- com `sourceType = 'effect'` e `sourceId = EffectInstance.id`.
ALTER TABLE "effect_instances" ADD COLUMN "conditions" JSONB NOT NULL DEFAULT '[]';
