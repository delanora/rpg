-- Definições no bestiário; consumo independente para cada cópia em combate.
ALTER TABLE "creatures" ADD COLUMN "abilities" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "combatants" ADD COLUMN "abilityUses" JSONB NOT NULL DEFAULT '{}';
