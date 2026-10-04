import type { Feat } from './types.js';

/**
 * Talentos de CATEGORIA B: efeito condicional ligado a AÇÃO/AÇÃO BÔNUS/REAÇÃO,
 * que depende do motor de ações (Fase 5) ainda não implementado. Ficam só como
 * texto + `other` + TODO — NÃO simular a ação/reação fora do combate.
 */
export const CATEGORY_B_FEATS: readonly Feat[] = [
  {
    id: 'charger',
    name: 'Investida',
    description:
      'Quando usa a ação Disparada, pode fazer um ataque corpo a corpo com arma como ação bônus; se tiver se movido pelo menos 3 m em linha reta, causa +5 de dano ou empurra o alvo 3 m. // TODO (Fase 5 — motor de ações): aplicar o efeito de Investida quando o motor de ação/ação bônus existir.',
    effects: [{ type: 'other' }],
  },
  {
    id: 'crossbow-expert',
    name: 'Especialista em Bestas',
    description:
      'Você ignora a recarga de bestas e não sofre desvantagem por atirar a até 1,5 m do alvo; atacar com besta de uma mão permite um ataque com arma de uma mão como ação bônus. // TODO (Fase 5 — motor de ações): aplicar o efeito de Especialista em Bestas quando o motor de ação/ação bônus existir.',
    effects: [{ type: 'other' }],
  },
  {
    id: 'defensive-duelist',
    name: 'Duelista Defensivo',
    description:
      'Quando empunha uma arma de acuidade e outra criatura o acerta, pode usar a reação para somar o bônus de proficiência à CA contra aquele ataque. // TODO (Fase 5 — motor de ações): aplicar o efeito de Duelista Defensivo quando o motor de reação existir.',
    effects: [{ type: 'other' }],
  },
  {
    id: 'dual-wielder',
    name: 'Usar Duas Armas',
    description:
      'Você ganha +1 na CA quando empunha duas armas, pode usar armas que não sejam leves e pode sacar/guardar duas armas no mesmo turno. // TODO (Fase 5 — motor de ações): aplicar o +1 de CA condicional e as demais cláusulas quando o motor de ações existir.',
    effects: [{ type: 'other' }],
  },
  {
    id: 'dungeon-delver',
    name: 'Explorador de Masmorras',
    description:
      'Você tem vantagem em Percepção e Investigação para achar portas secretas, resiste a armadilhas, viaja em ritmo normal procurando armadilhas e detecta magias sem vê-las. // TODO (Fase 5 — motor de ações): as vantagens/condições de exploração dependem de sistemas de exploração inexistentes.',
    effects: [{ type: 'other' }],
  },
  {
    id: 'great-weapon-master',
    name: 'Mestre de Armas Grandes',
    description:
      'Ao acertar com arma pesada, pode sofrer -5 no ataque para +10 de dano. Ao derrubar ou matar com crítico, ganha um ataque corpo a corpo como ação bônus. // TODO (Fase 5 — motor de ações): aplicar o efeito de Mestre de Armas Grandes quando o motor de ação/ação bônus existir.',
    effects: [{ type: 'other' }],
  },
  {
    id: 'healer',
    name: 'Curandeiro',
    description:
      'Usar um kit de curandeiro estabiliza e cura 1d6+4 PV. Uma criatura só pode se beneficiar desse descanso uma vez entre descansos longos. // TODO (Fase 5 — motor de ações): o uso do kit de curandeiro depende de uma ação de uso de item em combate.',
    effects: [{ type: 'other' }],
  },
  {
    id: 'inspiring-leader',
    name: 'Líder Inspirador',
    description:
      'Gaste 10 minutos inspirando aliados para conceder PV temporários iguais ao seu nível + modificador de Carisma (mínimo 1), uma vez por descanso. // TODO (Fase 5 — motor de ações): conceder PV temporários a aliados depende do motor de ações e de alvos múltiplos.',
    effects: [{ type: 'other' }],
  },
  {
    id: 'mage-slayer',
    name: 'Matador de Magos',
    description:
      'Criaturas a até 1,5 m têm desvantagem em conjurar; você pode usar a reação para atacar quem conjura e tem vantagem em salvaguardas contra magias de criaturas adjacentes. // TODO (Fase 5 — motor de ações): aplicar o efeito de Matador de Magos quando o motor de reação existir.',
    effects: [{ type: 'other' }],
  },
  {
    id: 'martial-adept',
    name: 'Adepto Marcial',
    description:
      'Você aprende duas manobras de Mestre de Batalha e ganha um dado de superioridade d6 (recuperado em descanso). // TODO (Fase 5 — motor de ações): as manobras e o dado de superioridade dependem do motor de manobras.',
    effects: [{ type: 'other' }],
  },
  {
    id: 'mounted-combatant',
    name: 'Combatente Montado',
    description:
      'Você tem vantagem em ataques contra criaturas menores que a sua montaria, pode redirecionar ataques contra ela para você e provoca apenas metade dos ataques de oportunidade. // TODO (Fase 5 — motor de ações): o combate montado depende de um sistema de montaria inexistente.',
    effects: [{ type: 'other' }],
  },
  {
    id: 'polearm-master',
    name: 'Mestre de Haste',
    description:
      'Ao atacar com arma de haste, pode atacar com a extremidade oposta como ação bônus. Criaturas que entram no seu alcance provocam ataque de oportunidade. // TODO (Fase 5 — motor de ações): aplicar o efeito de Mestre de Haste quando o motor de ação bônus existir.',
    effects: [{ type: 'other' }],
  },
  {
    id: 'savage-attacker',
    name: 'Atacante Selvagem',
    description:
      'Uma vez por turno, ao rolar o dano de uma arma corpo a corpo, você pode rerrolar os dados e usar o resultado que preferir. // TODO (Fase 5 — motor de ações): a rerrolagem de dano depende de uma escolha interativa no motor de combate.',
    effects: [{ type: 'other' }],
  },
  {
    id: 'sentinel',
    name: 'Sentinela',
    description:
      'Quando acerta um ataque de oportunidade, o deslocamento do alvo vira 0. Criaturas que se afastam provocam ataque mesmo desengajando, e você pode atacar quem ataca um aliado adjacente. // TODO (Fase 5 — motor de ações): aplicar o efeito de Sentinela quando o motor de reação existir.',
    effects: [{ type: 'other' }],
  },
  {
    id: 'sharpshooter',
    name: 'Atirador de Elite',
    description:
      'Você atira a longa distância sem desvantagem, ignora cobertura parcial e três quartos, e pode sofrer -5 no ataque por +10 de dano à distância. // TODO (Fase 5 — motor de ações): aplicar o efeito de Atirador de Elite quando o motor de ataque existir.',
    effects: [{ type: 'other' }],
  },
  {
    id: 'shield-master',
    name: 'Mestre de Escudo',
    description:
      'Se acertar um ataque no seu turno, pode usar a ação bônus para empurrar o alvo com o escudo; pode somar o bônus do escudo em salvaguardas de Destreza contra efeitos de área. // TODO (Fase 5 — motor de ações): aplicar o efeito de Mestre de Escudo quando o motor de ação bônus existir.',
    effects: [{ type: 'other' }],
  },
];
