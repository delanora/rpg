-- Lifecycle de LongRestSession — reparo de sessões ACTIVE órfãs.
--
-- INVARIANTE: uma sessão só pode estar ACTIVE enquanto o descanso
-- correspondente está realmente em andamento, ou seja, enquanto a solicitação
-- pai está APPROVED (ou não há solicitação — sessão individual). Abort e
-- conclusão já fecham as sessões na escrita; esta migration só normaliza o
-- resíduo deixado por versões/harness anteriores:
--
--   ACTIVE + solicitação CANCELLED  → CANCELLED (o descanso não aconteceu)
--   ACTIVE + solicitação COMPLETED  → COMPLETED (o descanso já terminou)
--
-- NÃO é destrutivo: nada é apagado, o histórico e a auditoria continuam
-- intactos; apenas a sessão passa para o estado terminal coerente, com o
-- carimbo de tempo da solicitação (ou o início da sessão, se ela não tiver
-- carimbo). Rodar duas vezes é inofensivo: na segunda não há mais ACTIVE órfã.

-- 1) Solicitação concluída ⇒ sessão concluída.
UPDATE "long_rest_sessions" AS s
   SET "status" = 'COMPLETED',
       "completedAt" = COALESCE(r."completedAt", s."startedAt")
  FROM "long_rest_requests" AS r
 WHERE s."longRestRequestId" = r."id"
   AND s."status" = 'ACTIVE'
   AND r."status" = 'COMPLETED';

-- 2) Solicitação cancelada ⇒ sessão cancelada (nenhum benefício foi aplicado).
UPDATE "long_rest_sessions" AS s
   SET "status" = 'CANCELLED',
       "cancelledAt" = COALESCE(r."cancelledAt", s."startedAt")
  FROM "long_rest_requests" AS r
 WHERE s."longRestRequestId" = r."id"
   AND s."status" = 'ACTIVE'
   AND r."status" = 'CANCELLED';
