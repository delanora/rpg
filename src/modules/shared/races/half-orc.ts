import type { Race } from './types.js';

/**
 * Meio-Orc (Half-Orc) — PHB 2014. Sem sub-raças.
 *
 * Só DADOS por enquanto: Ameaçador usa `skillProficiency` (Intimidação);
 * Resistência Implacável e Ataques Selvagens vão como `other` com TODO (o
 * primeiro depende do sistema de 0 PV/morte — Fase 5; o segundo depende do
 * motor de raça e da revisão do combate). `speed` em METROS (30 pés = 9 m).
 */
export const halfOrc: Race = {
  id: 'half-orc',
  namePt: 'Meio-Orc',
  nameEn: 'Half-Orc',
  description:
    'Fortes e inquebráveis, os meio-orcs carregam a fúria dos orcs e a determinação humana. ' +
    'Seu deslocamento é de 9 m (30 pés).',
  abilityScoreIncrease: [
    { ability: 'strength', amount: 2 },
    { ability: 'constitution', amount: 1 },
  ],
  speed: 9,
  size: 'Medium',
  // 18 m = 60 pés (visão no escuro).
  darkvision: 18,
  // TODO(idiomas): não há campo de idioma na ficha.
  languages: ['Comum', 'Orc'],
  traits: [
    {
      id: 'menacing',
      name: 'Ameaçador',
      description: 'Você tem proficiência na perícia Intimidação.',
      // Declarado como DADO: a proficiência real é aplicada pelo motor de raça.
      mechanicalEffect: { type: 'skillProficiency', target: 'intimidation' },
    },
    {
      id: 'relentless-endurance',
      name: 'Resistência Implacável',
      description:
        'Quando você cai a 0 pontos de vida sem morrer imediatamente, pode ficar com 1 ponto ' +
        'de vida em vez disso. Um uso por descanso longo.',
      // TODO: integrar com o sistema de 0 PV / morte instantânea (Fase 5), que
      // ainda não existe — não há onde pendurar a lógica hoje.
      mechanicalEffect: {
        type: 'other',
        id: 'relentless-endurance',
        name: 'Resistência Implacável',
        notes: 'Ficar com 1 PV ao cair a 0 (1×/descanso longo); depende do sistema de 0 PV (Fase 5).',
      },
    },
    {
      id: 'savage-attacks',
      name: 'Ataques Selvagens',
      description:
        'Quando você acerta um crítico corpo a corpo, role um dado de dano da arma adicional e ' +
        'some-o ao dano extra do crítico.',
      // TODO: o efeito é +1 dado de ARMA no crítico corpo a corpo. Entra quando o
      // motor de raça existir e o combate for revisto (o fluxo de ataque segue o
      // critExtraDice do Crítico Brutal). Não tocamos no combat.service.ts agora.
      mechanicalEffect: {
        type: 'other',
        id: 'savage-attacks',
        name: 'Ataques Selvagens',
        notes:
          '+1 dado de dano da arma no crítico corpo a corpo; integrar com o combate (critExtraDice) depois.',
      },
    },
  ],
};
