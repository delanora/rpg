-- Fase 6.6L.4.1.1 — CENAS da localidade e realinhamento do ownership das paredes.
--
-- Decisão de produto: a geometria estrutural pertence ao AMBIENTE persistente
-- (`Locality → Scene → SpatialObstacle`), não ao runtime do encontro. O combate
-- passa a REFERENCIAR uma cena (`combats.sceneId`), opcionalmente; combates
-- legados continuam usando `combats.spatialConfig` como fallback.
--
-- MIGRATION DEFENSIVA: a coluna `spatial_obstacles.combatId` é substituída por
-- `sceneId NOT NULL`. Um obstáculo existente NÃO teria como ser remapeado para
-- uma cena sem inventar ambiente (o combate pode nem ter localidade). Portanto,
-- se existir QUALQUER linha em `spatial_obstacles`, esta migration ABORTA com
-- mensagem explícita em vez de descartar geometria.
--
-- Unidades: PÉS (nunca metros/pixels).

CREATE TABLE "scenes" (
    "id" TEXT NOT NULL,
    "localityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spatialConfig" JSONB,
    "backgroundImageUrl" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scenes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "scenes_localityId_idx" ON "scenes"("localityId");

ALTER TABLE "scenes" ADD CONSTRAINT "scenes_localityId_fkey"
    FOREIGN KEY ("localityId") REFERENCES "localities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "scene_operations" (
    "id" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scene_operations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "scene_operations_sceneId_operationId_key"
    ON "scene_operations"("sceneId", "operationId");

ALTER TABLE "scene_operations" ADD CONSTRAINT "scene_operations_sceneId_fkey"
    FOREIGN KEY ("sceneId") REFERENCES "scenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "combats" ADD COLUMN "sceneId" TEXT;

CREATE INDEX "combats_sceneId_idx" ON "combats"("sceneId");

ALTER TABLE "combats" ADD CONSTRAINT "combats_sceneId_fkey"
    FOREIGN KEY ("sceneId") REFERENCES "scenes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- GUARDA DE DADOS: nenhum obstáculo pode ser descartado silenciosamente.
DO $$
DECLARE
    total INTEGER;
BEGIN
    SELECT COUNT(*) INTO total FROM "spatial_obstacles";
    IF total > 0 THEN
        RAISE EXCEPTION
            'Migration 20261106170000_add_locality_scenes abortada: % obstáculo(s) em spatial_obstacles estão ligados a combates e precisam ser remapeados para uma cena antes de trocar o ownership. Nenhum dado foi apagado.', total;
    END IF;
END $$;

ALTER TABLE "spatial_obstacles" DROP CONSTRAINT "spatial_obstacles_combatId_fkey";

DROP INDEX "spatial_obstacles_combatId_idx";

ALTER TABLE "spatial_obstacles" DROP COLUMN "combatId";

ALTER TABLE "spatial_obstacles" ADD COLUMN "sceneId" TEXT NOT NULL;

CREATE INDEX "spatial_obstacles_sceneId_idx" ON "spatial_obstacles"("sceneId");

ALTER TABLE "spatial_obstacles" ADD CONSTRAINT "spatial_obstacles_sceneId_fkey"
    FOREIGN KEY ("sceneId") REFERENCES "scenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
