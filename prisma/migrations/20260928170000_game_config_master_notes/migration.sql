-- Anotações privadas do mestre sobre a mesa (o "bloco de notas" dele).
--
-- Ficam na linha única de `game_config` (id = 'main'), como o contador de
-- liberações e o nível inicial. Diferente deles, NÃO entram no GET /api/game:
-- essa rota é acessível ao jogador, então as anotações só saem por
-- /api/game/notes, exclusiva de MASTER.

ALTER TABLE "game_config" ADD COLUMN "masterNotes" TEXT NOT NULL DEFAULT '';
