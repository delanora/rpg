-- Fundação do sistema de Raças: campos estruturados na ficha.
-- ADITIVA: só adiciona colunas. NÃO toca em `race` (texto livre), que continua
-- como está e não é derivada nem migrada nesta etapa.

ALTER TABLE "characters" ADD COLUMN     "raceId" TEXT;
ALTER TABLE "characters" ADD COLUMN     "subraceId" TEXT;
ALTER TABLE "characters" ADD COLUMN     "raceChoices" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "characters" ADD COLUMN     "customRaceId" TEXT;
