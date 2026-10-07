-- AlterTable: `kind` vira `type` — a IDENTIDADE lógica da operação.
ALTER TABLE "character_operations" RENAME COLUMN "kind" TO "type";

-- AlterTable: assinatura CANÔNICA do payload semântico (ex.: '{"die":10}').
-- A tabela está vazia nesta etapa, então a coluna entra NOT NULL sem default
-- (fica em sincronia com o schema Prisma, que a declara obrigatória).
ALTER TABLE "character_operations" ADD COLUMN "requestFingerprint" TEXT NOT NULL;

-- Normaliza o valor gravado pela versão anterior, caso exista alguma linha.
UPDATE "character_operations"
   SET "type" = 'SHORT_REST_HIT_DIE'
 WHERE "type" = 'short-rest-hit-die';
