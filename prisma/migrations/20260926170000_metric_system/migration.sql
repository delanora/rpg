-- Sistema métrico (convenção do livro em português):
--   deslocamento: 5 pés = 1,5 m  ->  0,3 m por pé
--   peso:         1 kg   = 2 lb  ->  metade do valor em libras
--
-- A migração converte os valores já gravados; a partir daqui tudo é
-- armazenado em metros e quilogramas.

-- Deslocamento das fichas e das criaturas (padrão 30 pés -> 9 m).
UPDATE "characters" SET "speed" = ROUND("speed" * 0.3)::int;
UPDATE "creatures" SET "speed" = ROUND("speed" * 0.3)::int;

-- Peso dos itens do catálogo (3 lb -> 1,5 kg; 0,5 lb -> 0,25 kg).
UPDATE "items" SET "weight" = ROUND(("weight" / 2)::numeric, 2);

-- Peso das cópias que já estão nos inventários das fichas.
UPDATE "characters"
SET "inventory" = COALESCE(
  (
    SELECT jsonb_agg(
      CASE
        WHEN entry ? 'weight' AND jsonb_typeof(entry -> 'weight') = 'number'
          THEN jsonb_set(
            entry,
            '{weight}',
            to_jsonb(ROUND(((entry ->> 'weight')::numeric / 2), 2))
          )
        ELSE entry
      END
    )
    FROM jsonb_array_elements("inventory") AS entry
  ),
  '[]'::jsonb
)
WHERE jsonb_typeof("inventory") = 'array';
