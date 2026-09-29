-- Proficiências de armadura, arma e ferramenta na ficha (PHB 2014, cap. 6).
--
-- O livro traz DUAS tabelas: o que a classe concede quando é a PRIMEIRA do
-- personagem (nível 1) e o conjunto reduzido de quando se entra nela por
-- multiclasse (p.164). Nenhuma entrada de multiclasse concede salvaguardas.
--
-- O backfill preenche as fichas existentes a partir de `classes`: a primeira
-- entrada recebe o conjunto completo e as demais o de multiclasse. As listas
-- ficam em ordem alfabética (dedupe do SQL) — a ordem de exibição só é a do
-- livro nas fichas criadas depois desta migration.

ALTER TABLE "characters" ADD COLUMN "proficiencies" JSONB NOT NULL DEFAULT '{}';

WITH grants ("classKey", "firstGrant", "multiclassGrant") AS (
  VALUES
    (
      'barbarian',
      '{"armor": ["Armaduras leves", "Armaduras médias", "Escudos"], "weapons": ["Armas simples", "Armas marciais"], "tools": []}'::jsonb,
      '{"armor": ["Escudos"], "weapons": ["Armas simples", "Armas marciais"], "tools": []}'::jsonb
    ),
    (
      'bard',
      '{"armor": ["Armaduras leves"], "weapons": ["Armas simples", "Bestas de mão", "Espadas longas", "Rapieiras", "Espadas curtas"], "tools": ["3 instrumentos musicais à sua escolha"]}'::jsonb,
      '{"armor": ["Armaduras leves"], "weapons": [], "tools": ["1 instrumento musical à sua escolha"]}'::jsonb
    ),
    (
      'cleric',
      '{"armor": ["Armaduras leves", "Armaduras médias", "Escudos"], "weapons": ["Armas simples"], "tools": []}'::jsonb,
      '{"armor": ["Armaduras leves", "Armaduras médias", "Escudos"], "weapons": [], "tools": []}'::jsonb
    ),
    (
      'druid',
      '{"armor": ["Armaduras leves", "Armaduras médias", "Escudos (não usa metal)"], "weapons": ["Clavas", "Adagas", "Dardos", "Azagaias", "Maças", "Bordões", "Cimitarras", "Foices", "Fundas", "Lanças"], "tools": ["Kit de herbalismo"]}'::jsonb,
      '{"armor": ["Armaduras leves", "Armaduras médias", "Escudos"], "weapons": [], "tools": []}'::jsonb
    ),
    (
      'fighter',
      '{"armor": ["Armaduras leves", "Armaduras médias", "Armaduras pesadas", "Escudos"], "weapons": ["Armas simples", "Armas marciais"], "tools": []}'::jsonb,
      '{"armor": ["Armaduras leves", "Armaduras médias", "Escudos"], "weapons": ["Armas simples", "Armas marciais"], "tools": []}'::jsonb
    ),
    (
      'monk',
      '{"armor": [], "weapons": ["Armas simples", "Espadas curtas"], "tools": ["1 ferramenta de artesão ou instrumento musical à sua escolha"]}'::jsonb,
      '{"armor": [], "weapons": ["Armas simples", "Espadas curtas"], "tools": []}'::jsonb
    ),
    (
      'paladin',
      '{"armor": ["Armaduras leves", "Armaduras médias", "Armaduras pesadas", "Escudos"], "weapons": ["Armas simples", "Armas marciais"], "tools": []}'::jsonb,
      '{"armor": ["Armaduras leves", "Armaduras médias", "Escudos"], "weapons": ["Armas simples", "Armas marciais"], "tools": []}'::jsonb
    ),
    (
      'ranger',
      '{"armor": ["Armaduras leves", "Armaduras médias", "Escudos"], "weapons": ["Armas simples", "Armas marciais"], "tools": []}'::jsonb,
      '{"armor": ["Armaduras leves", "Armaduras médias", "Escudos"], "weapons": ["Armas simples", "Armas marciais"], "tools": []}'::jsonb
    ),
    (
      'rogue',
      '{"armor": ["Armaduras leves"], "weapons": ["Armas simples", "Bestas de mão", "Espadas longas", "Rapieiras", "Espadas curtas"], "tools": ["Ferramentas de ladrão"]}'::jsonb,
      '{"armor": ["Armaduras leves"], "weapons": [], "tools": ["Ferramentas de ladrão"]}'::jsonb
    ),
    (
      'sorcerer',
      '{"armor": [], "weapons": ["Adagas", "Dardos", "Fundas", "Bordões", "Bestas leves"], "tools": []}'::jsonb,
      '{"armor": [], "weapons": [], "tools": []}'::jsonb
    ),
    (
      'warlock',
      '{"armor": ["Armaduras leves"], "weapons": ["Armas simples"], "tools": []}'::jsonb,
      '{"armor": ["Armaduras leves"], "weapons": ["Armas simples"], "tools": []}'::jsonb
    ),
    (
      'wizard',
      '{"armor": [], "weapons": ["Adagas", "Dardos", "Fundas", "Bordões", "Bestas leves"], "tools": []}'::jsonb,
      '{"armor": [], "weapons": [], "tools": []}'::jsonb
    )
),
entries AS (
  SELECT
    c.id AS character_id,
    e.entry ->> 'classKey' AS class_key,
    e.ord
  FROM "characters" c
  CROSS JOIN LATERAL jsonb_array_elements(c."classes") WITH ORDINALITY AS e(entry, ord)
  WHERE jsonb_typeof(c."classes") = 'array'
    AND e.entry ->> 'classKey' IS NOT NULL
),
collected AS (
  SELECT
    en.character_id,
    CASE WHEN en.ord = 1 THEN g."firstGrant" ELSE g."multiclassGrant" END AS grant
  FROM entries en
  JOIN grants g ON g."classKey" = en.class_key
)
UPDATE "characters" c
SET "proficiencies" = jsonb_build_object(
  'armor', COALESCE((
    SELECT jsonb_agg(DISTINCT v)
    FROM collected m, jsonb_array_elements_text(m.grant -> 'armor') AS v
    WHERE m.character_id = c.id
  ), '[]'::jsonb),
  'weapons', COALESCE((
    SELECT jsonb_agg(DISTINCT v)
    FROM collected m, jsonb_array_elements_text(m.grant -> 'weapons') AS v
    WHERE m.character_id = c.id
  ), '[]'::jsonb),
  'tools', COALESCE((
    SELECT jsonb_agg(DISTINCT v)
    FROM collected m, jsonb_array_elements_text(m.grant -> 'tools') AS v
    WHERE m.character_id = c.id
  ), '[]'::jsonb)
);
