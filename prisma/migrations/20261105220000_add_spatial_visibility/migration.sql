-- 6.6L.3.2 — VISIBILIDADE ESPACIAL POR INSTÂNCIA.
--
-- `public` (padrão) projeta token/imagem/posição/tamanho no grid do PLAYER.
-- `master-only` omite a PRESENÇA ESPACIAL do PLAYER (o Mestre continua vendo).
--
-- Aditiva e com DEFAULT: todo combatente existente passa a ser público — o
-- comportamento anterior (esconder 100% dos NPCs) era o bug corrigido aqui.
ALTER TABLE "combatants" ADD COLUMN "spatialVisibility" TEXT NOT NULL DEFAULT 'public';
