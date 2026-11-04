-- FASE 6.6H — DURAÇÃO, EXPIRAÇÃO E LIFECYCLE POR TURNO.
--
-- Aditiva e sem backfill destrutivo:
--  • `spell_casts.durationSnapshot` — snapshot imutável do relógio de duração
--    tirado no COMMIT (nunca recalculado depois);
--  • `spell_casts.resolutionReason` — por que um cast `resolving` terminou sem
--    Effect (ex.: `duration-expired`), sem reescrever `outcome` histórico;
--  • `effect_instances.durationSnapshot` / `turnTriggers` — o Effect carrega o
--    próprio lifecycle (copiado do cast/definição), sem depender de registry em
--    memória para efeitos antigos;
--  • `pending_effect_saves` ganha fase (`initial`/`ongoing`), vínculo com a
--    instância, identidade da ocorrência do trigger, opcionalidade e
--    `declinedAt` (recusar NÃO é falhar).
--
-- O índice único da ocorrência é PARCIAL (`phase = 'ongoing'`) porque o Prisma
-- não expressa índice parcial no schema — mesmo padrão de `combats_one_active_key`.

ALTER TABLE "spell_casts"
  ADD COLUMN "durationSnapshot" JSONB,
  ADD COLUMN "resolutionReason" TEXT;

ALTER TABLE "effect_instances"
  ADD COLUMN "durationSnapshot" JSONB,
  ADD COLUMN "turnTriggers" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "pending_effect_saves"
  ADD COLUMN "phase" TEXT NOT NULL DEFAULT 'initial',
  ADD COLUMN "effectInstanceId" TEXT,
  ADD COLUMN "triggerKey" TEXT,
  ADD COLUMN "triggerOccurrenceId" TEXT,
  ADD COLUMN "optional" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "declinedAt" TIMESTAMP(3);

CREATE INDEX "pending_effect_saves_phase_status_idx"
  ON "pending_effect_saves" ("phase", "status");

CREATE INDEX "pending_effect_saves_effect_instance_idx"
  ON "pending_effect_saves" ("effectInstanceId", "status");

-- Uma ocorrência de trigger de um efeito contínuo tem no máximo UMA pendência,
-- garantido pelo BANCO (nunca mutex de processo). Recusa/rolagem terminal não
-- recria a mesma ocorrência no retry.
CREATE UNIQUE INDEX "pending_effect_saves_ongoing_occurrence_key"
  ON "pending_effect_saves" ("effectInstanceId", "triggerOccurrenceId")
  WHERE "phase" = 'ongoing';
