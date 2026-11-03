import { Router } from 'express';
import { authenticate, requireRole } from '../../auth/auth.middleware.js';
import { spellCastProofSchema } from './spell-cast.schema.js';
import { castProofSpell } from './spell-cast.service.js';

/**
 * FASE 6.6A — API GENÉRICA de conjuração de PROVA (só MASTER).
 *
 * Existe para validar o contrato (validação → commit → resolução) e o registry
 * de execução. NÃO é a API final de conjuração: PLAYER continua sem cast até
 * slot/Ação/componentes/preparação existirem (6.6B+). As rotas de prova de
 * Bless/Hold Person continuam existindo como wrappers finos deste serviço.
 */
export const spellsRouter = Router();
spellsRouter.use(authenticate);

/** POST /api/spells/cast-proof — valida, commita e resolve uma conjuração. */
spellsRouter.post('/cast-proof', requireRole('MASTER'), async (req, res) => {
  const parsed = spellCastProofSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.flatten().fieldErrors });
    return;
  }
  const actor = {
    userId: req.user!.sub,
    username: req.user!.username,
    role: req.user!.role,
  };
  const result = await castProofSpell(actor, parsed.data);
  res.status(result.replayed ? 200 : 201).json({
    cast: result.cast,
    effectGroupId: result.effectGroupId,
    pendingId: result.pending?.id ?? null,
    replayed: result.replayed,
  });
});
