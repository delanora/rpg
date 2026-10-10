-- 5.2.7A — "Recurso de Acampamento" vira CATEGORIA real de item.
--
-- A categoria (`CAMP_SUPPLY`) passa a ser a FONTE DE VERDADE da mecânica
-- opcional de Recursos de Acampamento do Descanso Longo coletivo. O flag
-- `campSupplyEnabled` continua no banco apenas como ESPELHO derivado dela — o
-- servidor o força na escrita (src/modules/items/items.service.ts).
--
-- BACKFILL NÃO DESTRUTIVO: nenhum `campSupplyValue` é apagado e nenhum item
-- deixa de funcionar. O que fazemos é alinhar as duas colunas para os itens
-- cadastrados antes desta fase:
--
--   1) Itens marcados SÓ pela flag antiga ganham a categoria real. É a conversão
--      contada no relatório (hoje: nenhum item nesse estado).
UPDATE "items"
   SET "category" = 'CAMP_SUPPLY'
 WHERE "campSupplyEnabled" = true
   AND "category" <> 'CAMP_SUPPLY';

--   2) Normaliza o espelho: categoria de acampamento ⇒ flag ligada; qualquer
--      outra categoria ⇒ flag desligada.
UPDATE "items"
   SET "campSupplyEnabled" = true
 WHERE "category" = 'CAMP_SUPPLY'
   AND "campSupplyEnabled" = false;

UPDATE "items"
   SET "campSupplyEnabled" = false
 WHERE "category" <> 'CAMP_SUPPLY'
   AND "campSupplyEnabled" = true;
