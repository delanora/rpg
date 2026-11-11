/** Forma pública efêmera; sem CD, dano numérico, custos ou candidatos privados. */
export interface CombatAreaVisualPayload {
  previewId: string;
  sequence: number;
  combatId: string;
  authorId: string;
  expiresAt: number;
  area: {
    combatantId: string;
    origin: { xFeet: number; yFeet: number };
    angle: number;
    shape: import('../spells/execution/area-targeting.js').AreaShapeDefinition;
    damageType: import('./attacks.js').DamageType;
  } | null;
}
