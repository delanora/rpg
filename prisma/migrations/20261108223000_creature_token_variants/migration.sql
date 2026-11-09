ALTER TABLE "creatures" ADD COLUMN "tokenImages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "combatants" ADD COLUMN "tokenImageUrl" TEXT, ADD COLUMN "tokenNumber" INTEGER;
