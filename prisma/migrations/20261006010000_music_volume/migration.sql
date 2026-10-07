-- Volume sincronizado da música ambiente.
--
-- O volume é parte do estado da reprodução (mesma linha única de
-- `music_state`): o mestre o define e o servidor publica para a mesa, então
-- todos os jogadores passam a ouvir nesse volume.

ALTER TABLE "music_state" ADD COLUMN "volume" DOUBLE PRECISION NOT NULL DEFAULT 1;
