/** Projeção de consentimento; não substitui economia, ataques nem movimento. */
export interface CombatDuelDto {
  id: string;
  requesterId: string;
  challengedId: string;
  status: 'pending' | 'active';
}
