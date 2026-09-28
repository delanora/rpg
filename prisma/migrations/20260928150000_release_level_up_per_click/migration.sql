-- Level Up por clique: o mestre libera e o jogador sobe UM nível, sem precisar
-- bloquear antes de liberar de novo.
--
-- A coluna `levelUpUnlocked` (o liga/desliga antigo) sai: o que vale agora é só
-- o contador `levelUpRelease`, que avança a cada clique em "Liberar Level Up".

ALTER TABLE "game_config" DROP COLUMN "levelUpUnlocked";
