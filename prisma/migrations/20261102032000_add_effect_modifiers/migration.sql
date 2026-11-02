-- FASE 6.5B — modificadores mecânicos tipados por instância de efeito.
--
-- ADITIVO e não destrutivo: as instâncias existentes (6.5A) ficam com a lista
-- vazia, ou seja, continuam sem modificar nada — comportamento anterior.
ALTER TABLE "effect_instances" ADD COLUMN "modifiers" JSONB NOT NULL DEFAULT '[]';
