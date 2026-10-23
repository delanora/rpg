import { abilityModifier, proficiencyBonus } from './dnd5e.js';

/**
 * SABEDORIA (MEDICINA) — PHB 2014, p. 178.
 *
 * Estabilizar uma criatura a 0 PV é uma AÇÃO e um teste de Sabedoria
 * (Medicina) CD 10. Não exige proficiência; quem for proficiente soma o bônus
 * de proficiência (e Expertise, quando houver). A regra é PURA aqui: quem
 * monta os valores é o domínio do combate; nenhum bônus vem do cliente.
 */

/** Classe de dificuldade para estabilizar uma criatura (PHB 2014). */
export const STABILIZE_DC = 10;

export interface MedicineBonusInput {
  /** Sabedoria da criatura (1 a 30). */
  wisdom: number;
  /** Nível total do personagem (bônus de proficiência); 1 para criaturas. */
  level: number;
  proficient: boolean;
  expertise: boolean;
  /**
   * Metade da proficiência em testes SEM proficiência (Pau para Toda Obra).
   * Quando mais de um efeito vale, este é o MAIOR valor — nunca a soma.
   */
  halfProficiency?: number;
}

export interface MedicineBonus {
  /** d20 + Sabedoria + proficiência. */
  total: number;
  /** Modificador de Sabedoria isolado (auditoria/exibição). */
  wisdom: number;
  /** Parcela de proficiência aplicada (0 sem proficiência). */
  proficiency: number;
}

export function medicineBonus(input: MedicineBonusInput): MedicineBonus {
  const wisdom = abilityModifier(input.wisdom);
  const proficiency = input.proficient
    ? proficiencyBonus(input.level) * (input.expertise ? 2 : 1)
    : Math.max(0, input.halfProficiency ?? 0);
  return { total: wisdom + proficiency, wisdom, proficiency };
}

/** Sucesso na estabilização: total do teste >= CD 10. */
export function stabilizationSucceeds(total: number): boolean {
  return total >= STABILIZE_DC;
}
