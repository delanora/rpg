ALTER TABLE "spatial_obstacles" ADD COLUMN "coverLevel" TEXT;
UPDATE "spatial_obstacles" SET "coverLevel" = CASE WHEN "blocksTargeting" THEN 'total' ELSE 'none' END;
ALTER TABLE "spatial_obstacles" ADD CONSTRAINT "spatial_obstacles_cover_level_check" CHECK ("coverLevel" IN ('none', 'half', 'three-quarters', 'total'));
ALTER TABLE "spatial_obstacles" ADD CONSTRAINT "spatial_obstacles_cover_targeting_check" CHECK ("coverLevel" IS NULL OR "blocksTargeting" = ("coverLevel" = 'total'));
