-- Histórico do que CADA nível concedeu.
--
-- É o que permite ao mestre REVERTER um nível (POST /api/characters/:id/level-down)
-- sem adivinhar: para cada nível fica gravado o PV ganho (dado + Constituição +
-- ajuste retroativo de Constituição), o Aumento de Atributo/Talento, as escolhas
-- de característica, a subclasse, a perícia de multiclasse e as proficiências
-- somadas naquele nível.
--
-- O backfill é vazio: níveis já existentes não têm registro e o downgrade cai no
-- caminho estimado (média do dado de vida + Constituição, com aviso na resposta).

ALTER TABLE "characters"
  ADD COLUMN "levelHistory" JSONB NOT NULL DEFAULT '[]';
