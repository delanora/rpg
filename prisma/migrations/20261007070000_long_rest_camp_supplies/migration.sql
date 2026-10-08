-- Recursos de acampamento do Descanso Longo coletivo (mecânica OPCIONAL).

-- Configuração global: liga/desliga a mecânica e o custo por participante.
ALTER TABLE "game_config"
  ADD COLUMN "campSuppliesEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "campSupplyCostPerParticipant" INTEGER NOT NULL DEFAULT 10;

-- O item do catálogo pode ser marcado como recurso de acampamento (propriedade
-- explícita, nunca inferida por nome/categoria).
ALTER TABLE "items"
  ADD COLUMN "campSupplyEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "campSupplyValue" INTEGER NOT NULL DEFAULT 0;

-- Contribuições persistentes por pilha do inventário.
CREATE TABLE "long_rest_camp_supply_contributions" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "inventoryItemId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "long_rest_camp_supply_contributions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "long_rest_camp_supply_contributions_requestId_inventoryItemId_key"
  ON "long_rest_camp_supply_contributions"("requestId", "inventoryItemId");
CREATE INDEX "long_rest_camp_supply_contributions_requestId_idx"
  ON "long_rest_camp_supply_contributions"("requestId");
CREATE INDEX "long_rest_camp_supply_contributions_characterId_idx"
  ON "long_rest_camp_supply_contributions"("characterId");
CREATE INDEX "long_rest_camp_supply_contributions_inventoryItemId_idx"
  ON "long_rest_camp_supply_contributions"("inventoryItemId");

ALTER TABLE "long_rest_camp_supply_contributions"
  ADD CONSTRAINT "long_rest_camp_supply_contributions_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "long_rest_requests"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "long_rest_camp_supply_contributions"
  ADD CONSTRAINT "long_rest_camp_supply_contributions_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "characters"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
