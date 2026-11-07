-- Fase 6.6M.6.3.1 — Personalização persistente dos 48 slots da Hotbar.
-- Migration ADITIVA: nenhuma coluna/tabela existente é alterada ou removida.
--
-- A coluna nasce NULL de propósito: "nunca personalizada" (preenchimento
-- automático) e "configuração vazia salva" são estados DIFERENTES. Preencher
-- com `[]` converteria todas as fichas existentes em "Hotbar vazia", quebrando
-- o comportamento atual de quem nunca abriu o editor.

ALTER TABLE "characters" ADD COLUMN "hotbar" JSONB;
