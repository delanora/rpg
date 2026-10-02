-- Raridade e sintonização dos itens do catálogo (PHB 2014).
--
-- `rarity` nasce NULL: os itens já cadastrados continuam válidos e são exibidos
-- sem raridade ("—"). Valores aceitos (validados na aplicação): common,
-- uncommon, rare, very_rare, legendary, artifact.
-- `requiresAttunement` é uma propriedade MANUAL do mestre, independente da
-- raridade (nenhuma regra automática); nasce false.
--
-- O antigo campo `details.attunement` (existente só na categoria Anel) é
-- INCORPORADO aqui: a sintonização deixa de viver no JSONB por categoria e
-- passa a ser um campo único, válido para todas as categorias.

ALTER TABLE "items"
  ADD COLUMN "rarity" TEXT,
  ADD COLUMN "requiresAttunement" BOOLEAN NOT NULL DEFAULT false;

-- Migra para o campo global qualquer item que já tivesse sintonização gravada.
UPDATE "items"
  SET "requiresAttunement" = true
  WHERE ("details" ->> 'attunement')::boolean = true;

-- Remove a chave antiga do JSONB para não restar dado duplicado.
UPDATE "items"
  SET "details" = "details" - 'attunement'
  WHERE "details" ? 'attunement';

CREATE INDEX "items_rarity_idx" ON "items"("rarity");
