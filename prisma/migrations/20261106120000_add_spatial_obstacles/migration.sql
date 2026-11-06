-- Fase 6.6L.4.1 — fundação de paredes/obstáculos espaciais (aditiva).
--
-- Owner: `combats` (a cena espacial persistente já vive em `Combat.spatialConfig`).
-- A parede é um segmento 2D de espessura ZERO com endpoints em PÉS; nada de
-- pixels/metros/SVG. `blocksMovement` e `blocksSight` são independentes.
--
-- Nenhum dado existente muda: combates sem paredes continuam com `obstacles = []`
-- na projeção (`Combat.spatial.obstacles`).

CREATE TABLE "spatial_obstacles" (
    "id" TEXT NOT NULL,
    "combatId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'wall',
    "startXFeet" DOUBLE PRECISION NOT NULL,
    "startYFeet" DOUBLE PRECISION NOT NULL,
    "endXFeet" DOUBLE PRECISION NOT NULL,
    "endYFeet" DOUBLE PRECISION NOT NULL,
    "blocksMovement" BOOLEAN NOT NULL DEFAULT true,
    "blocksSight" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spatial_obstacles_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "spatial_obstacles_combatId_idx" ON "spatial_obstacles"("combatId");

ALTER TABLE "spatial_obstacles" ADD CONSTRAINT "spatial_obstacles_combatId_fkey"
    FOREIGN KEY ("combatId") REFERENCES "combats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
