-- Campos aditivos: cadastros antigos não ganham ações lendárias implicitamente.
ALTER TABLE "creatures" ADD COLUMN "legendaryActionsMax" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "combats" ADD COLUMN "legendaryWindow" JSONB;
ALTER TABLE "combatants" ADD COLUMN "legendaryState" JSONB NOT NULL DEFAULT '{}';
