-- AlterTable
ALTER TABLE "combats" ADD COLUMN     "economyLog" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "combatants" ADD COLUMN     "turnEconomy" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "combat_operations" (
    "id" TEXT NOT NULL,
    "combatId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "combat_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "combat_operations_combatId_operationId_key" ON "combat_operations"("combatId", "operationId");

-- AddForeignKey
ALTER TABLE "combat_operations" ADD CONSTRAINT "combat_operations_combatId_fkey" FOREIGN KEY ("combatId") REFERENCES "combats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Combates já ativos recebem a fundação uma única vez no deploy, sem alterar
-- iniciativa, PV ou fichas. Daqui em diante apenas onTurnStart recupera economia.
WITH ordem AS (
  SELECT cb."id", c."currentIndex", c."status",
         ROW_NUMBER() OVER (PARTITION BY cb."combatId" ORDER BY cb."initiative" DESC NULLS LAST, cb."dexterityMod" DESC, cb."name") - 1 AS posicao,
         GREATEST(COALESCE(ch."speed", cr."speed", 0), 0) AS velocidade
  FROM "combatants" cb
  JOIN "combats" c ON c."id" = cb."combatId"
  LEFT JOIN "characters" ch ON ch."id" = cb."characterId"
  LEFT JOIN "creatures" cr ON cr."id" = cb."creatureId"
  WHERE c."status" = 'ACTIVE'
)
UPDATE "combatants" cb
SET "turnEconomy" = jsonb_build_object(
  'actionsGranted', CASE WHEN o.posicao = o."currentIndex" THEN 1 ELSE 0 END,
  'movementBudget', CASE WHEN o.posicao = o."currentIndex" THEN o.velocidade ELSE 0 END,
  'reactionAvailable', true
)
FROM ordem o WHERE cb."id" = o."id";
