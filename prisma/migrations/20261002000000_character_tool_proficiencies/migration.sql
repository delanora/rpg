-- Proficiências simples em ferramentas, pelos ids estáveis do catálogo do PHB
-- 2014 (src/modules/shared/tools). Nasce vazio: nesta etapa NENHUMA classe,
-- raça ou antecedente concede ferramenta automaticamente — o campo só existe
-- para o mestre (e o Level Up) gravarem ids como "thieves-tools".
--
-- A Expertise tem campo próprio (`expertiseSkills`, com o prefixo `tool:`) e
-- pode referenciar os mesmos ids. Sem backfill: fichas existentes ficam com [].

ALTER TABLE "characters"
  ADD COLUMN "toolProficiencies" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
