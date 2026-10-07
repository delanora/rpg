-- Música ambiente da mesa.
--
-- `music_tracks` é o catálogo de faixas (o arquivo em si vive em
-- `uploads/music/`) e `music_state` é a linha única com o estado da
-- reprodução, que o servidor publica para mestres e jogadores.

CREATE TABLE "music_tracks" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "duration" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "size" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "music_tracks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "music_state" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "trackId" TEXT,
    "playing" BOOLEAN NOT NULL DEFAULT false,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "repeat" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "music_state_pkey" PRIMARY KEY ("id")
);
