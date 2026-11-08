-- Inicialização aprovada: copia o bloqueio de movimento uma única vez.
ALTER TABLE "spatial_obstacles" ADD COLUMN "blocksTargeting" BOOLEAN NOT NULL DEFAULT true;
UPDATE "spatial_obstacles" SET "blocksTargeting" = "blocksMovement";
