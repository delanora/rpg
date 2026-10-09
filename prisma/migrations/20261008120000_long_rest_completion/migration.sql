-- Conclusão REAL do Descanso Longo coletivo.
--
-- Ready: quando o participante terminou as decisões pessoais (não é aprovação
-- mecânica — recursos de acampamento insuficientes NÃO impedem o ready).
ALTER TABLE "long_rest_sessions"
  ADD COLUMN "readyAt" TIMESTAMP(3);

-- Seleção (por face) dos Dados de Vida a recuperar na conclusão. O jogador
-- escolhe em multiclasse; nada é aplicado até o descanso concluir.
ALTER TABLE "long_rest_sessions"
  ADD COLUMN "hitDiceRecoverySelection" JSONB NOT NULL DEFAULT '{}';
