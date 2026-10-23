import type { CombatantDto, SessionUser } from '../types';

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
