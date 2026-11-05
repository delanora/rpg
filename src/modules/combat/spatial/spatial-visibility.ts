/**
 * FASE 6.6L.3.2 — VISIBILIDADE ESPACIAL DA INSTÂNCIA.
 *
 * Separa DUAS políticas que estavam misturadas em `kind !== 'CHARACTER'`:
 *
 *  • ESTADO MECÂNICO PRIVADO — PV, PV máximo, CA, `deathState`, Death Saves,
 *    economia, Conditions de 0 PV, lado do encontro. Continua privado do Mestre
 *    para criatura/NPC (`hasPrivateMechanicalState`), independente daqui.
 *  • PRESENÇA ESPACIAL PÚBLICA — token, imagem, posição, tamanho e espaço
 *    ocupado. É o que este módulo decide, por INSTÂNCIA do combate.
 *
 * `master-only` NÃO é "não existe mecanicamente": o ocupante continua ocupando
 * espaço, bloqueando passagem e gerando difficult terrain. Também NÃO é
 * Invisible/Hide/LoS/Fog of War — essas políticas são futuras e NÃO devem ser
 * ligadas automaticamente a este campo.
 */

export const SPATIAL_VISIBILITIES = ['public', 'master-only'] as const;

export type SpatialVisibility = (typeof SPATIAL_VISIBILITIES)[number];

/**
 * Leitura tolerante: valor ausente/ inválido (combate gravado antes da
 * migration ou payload corrompido) cai em `public` — nunca "oculto por
 * acidente", que esconderia NPCs legítimos do grid.
 */
export function spatialVisibilityOf(value: unknown): SpatialVisibility {
  return value === 'master-only' ? 'master-only' : 'public';
}

/** A presença espacial deste combatente pode ser projetada ao jogador? */
export function isSpatiallyVisible(value: unknown): boolean {
  return spatialVisibilityOf(value) === 'public';
}
