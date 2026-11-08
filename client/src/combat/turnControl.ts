import type { CombatantDto, CombatStatus, SessionUser } from '../types';

/**
 * QUEM CONTROLA O COMBATENTE DO TURNO? — derivação ÚNICA do cliente.
 *
 * Ela dirige o painel de ataques, o menu de Ações, o Movimento, o Encerrar
 * Turno, a barra de recursos, o toast, o painel de espera e o painel de Reação.
 * A regra é a mesma do servidor:
 *
 * • PLAYER controla o personagem dele (`ownerUserId`);
 * • MASTER controla criaturas/NPCs (estado privado do Mestre) — NÃO controla o
 *   turno de um personagem de jogador, mesmo podendo ver e administrar tudo.
 *
 * A autoridade continua no servidor (`requireOwnTurn`); isto só decide o que o
 * cliente RENDERIZA. Não espalhe condições divergentes pelos componentes.
 */
export function currentUserControlsCombatant(
  combatant: CombatantDto | null,
  user: SessionUser,
): boolean {
  if (!combatant) return false;
  if (user.role === 'MASTER') return combatant.kind !== 'CHARACTER';
  return combatant.ownerUserId === user.id;
}

/**
 * 6.6M.3 — QUEM PODE MOVER MECANICAMENTE AGORA.
 *
 * Derivação ÚNICA para o modo Mover do grid. Ela só decide o que a UI oferece:
 * o servidor continua validando turno, autoridade, morte, deslocamento e
 * Reaction Gate (403/409). Regras aqui são de ELEGIBILIDADE VISUAL:
 *
 * • só em combate ACTIVE e com grid ativo;
 * • só o combatente do turno;
 * • quem o controla ou o Mestre que assumiu explicitamente aquele turno;
 * • precisa estar posicionado, vivo e com deslocamento/saldo.
 *
 * Placement administrativo NUNCA passa por aqui.
 */
export interface MovementAuthority {
  /** Combatente que este usuário pode mover agora (`null` = ninguém). */
  combatantId: string | null;
  /** Motivo sanitizado para a UI (nunca vira regra de jogo). */
  reason: string | null;
}

export interface MovementAuthorityInput {
  status: CombatStatus;
  currentCombatantId: string | null;
  combatants: readonly CombatantDto[];
  user: SessionUser;
  gridActive: boolean;
  /** Assunção explícita do Mestre, válida apenas para o turno atual. */
  assumedCombatantId?: string | null;
}

export function movementAuthorityOf({
  status,
  currentCombatantId,
  combatants,
  user,
  gridActive,
  assumedCombatantId = null,
}: MovementAuthorityInput): MovementAuthority {
  if (!gridActive) {
    return { combatantId: null, reason: 'Ative o grid para mover mecanicamente.' };
  }
  if (status !== 'ACTIVE') {
    return {
      combatantId: null,
      reason: 'O movimento mecânico acontece durante o combate ativo.',
    };
  }
  const current = combatants.find((item) => item.id === currentCombatantId) ?? null;
  if (!current) {
    return { combatantId: null, reason: 'Nenhum combatente no turno.' };
  }
  const assumedByMaster = user.role === 'MASTER' && assumedCombatantId === current.id;
  if (!currentUserControlsCombatant(current, user) && !assumedByMaster) {
    return { combatantId: null, reason: 'Só o combatente do turno pode se mover agora.' };
  }
  if (!current.spatial?.position) {
    return {
      combatantId: null,
      reason:
        user.role === 'MASTER'
          ? 'Use Posicionar antes de mover esta unidade.'
          : 'Seu token ainda não foi posicionado pelo Mestre.',
    };
  }
  if (current.deathBlocksActions) {
    return { combatantId: null, reason: 'Este combatente não pode se mover agora.' };
  }
  if (current.effectiveSpeed <= 0) {
    return { combatantId: null, reason: 'Deslocamento efetivo zero: não é possível se mover.' };
  }
  const remaining = current.turnEconomy.movementBudget - current.turnEconomy.movementUsed;
  if (remaining <= 0) {
    return { combatantId: null, reason: 'Sem movimento restante neste turno.' };
  }
  return { combatantId: current.id, reason: null };
}

/**
 * Combatente que a interface operacional representa agora.
 *
 * Jogador: sempre o próprio personagem. Mestre: o combatente do turno (ou o
 * override manual DAQUELE turno, que não sobrevive à virada).
 */
export function actingCombatantFor(
  combatants: CombatantDto[],
  current: CombatantDto | null,
  user: SessionUser,
  masterAttackerId: string,
): CombatantDto | null {
  if (user.role !== 'MASTER') {
    return combatants.find((item) => item.ownerUserId === user.id) ?? null;
  }
  return combatants.find((item) => item.id === masterAttackerId) ?? current;
}
