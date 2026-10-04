import type { AbilityKey, ClassFeatureEffect } from './types';

/**
 * Catálogo de talentos do Livro do Jogador (PHB 2014) — ESPELHO do catálogo do
 * servidor (`src/modules/shared/feats/`), no mesmo padrão de `dnd.ts` (que
 * espelha `shared/dnd5e.ts`). O servidor é a fonte da verdade dos efeitos; aqui
 * ficam a lista para o assistente de Level Up e o que a ficha exibe.
 *
 * Os talentos de Categoria B/C trazem só o texto (o efeito mecânico depende do
 * motor de ações ou de sistemas que ainda não existem).
 */
export interface FeatAbilityChoice {
  options: AbilityKey[];
  amount: number;
}

export interface FeatDefinition {
  /** Id estável (o mesmo do catálogo do servidor). */
  id: string;
  name: string;
  description: string;
  prerequisite?: string;
  /** Efeitos processados no servidor (só os talentos de Categoria A). */
  effects?: ClassFeatureEffect[];
  /** Bônus de atributo à escolha (half-feats). */
  abilityChoice?: FeatAbilityChoice;
  /** Concede proficiência na salvaguarda do atributo escolhido (Resiliente). */
  saveProficiency?: boolean;
}

export const FEATS: readonly FeatDefinition[] = [
  // --- Categoria A -----------------------------------------------------------
  {
    id: 'actor',
    name: 'Ator',
    description:
      'Aumente Carisma em 1 (máx. 20). Você tem vantagem em testes de Enganação e Atuação ao se passar por outra pessoa, e pode imitar a fala de alguém ou os sons de outras criaturas.',
    effects: [{ type: 'abilityBonus', ability: 'charisma', value: 1, max: 20 }],
  },
  {
    id: 'athlete',
    name: 'Atleta',
    description:
      'Aumente Força ou Destreza em 1 (máx. 20). Ficar de pé custa apenas 1,5 m de deslocamento, subir exige metade do movimento e você salta com corrida de apenas 1,5 m.',
    abilityChoice: { options: ['strength', 'dexterity'], amount: 1 },
  },
  {
    id: 'durable',
    name: 'Robusto',
    description:
      'Aumente Constituição em 1 (máx. 20). Ao rolar um Dado de Vida para recuperar PV, o valor mínimo por dado é dobrado o modificador de Constituição.',
    effects: [{ type: 'abilityBonus', ability: 'constitution', value: 1, max: 20 }],
  },
  {
    id: 'grappler',
    name: 'Lutador',
    description:
      'Aumente Força ou Destreza em 1 (máx. 20). Você tem vantagem em ataques contra criaturas agarradas e pode usar a ação de agarrar sem ter uma mão livre.',
    abilityChoice: { options: ['strength', 'dexterity'], amount: 1 },
  },
  {
    id: 'lightly-armored',
    name: 'Armadura Leve',
    description:
      'Aumente Força ou Destreza em 1 (máx. 20). Você ganha proficiência com armaduras leves. // TODO: a proficiência de armadura só terá efeito mecânico quando o efeito mecânico das proficiências (A15) for implementado.',
    abilityChoice: { options: ['strength', 'dexterity'], amount: 1 },
  },
  {
    id: 'moderately-armored',
    name: 'Armadura Moderada',
    description:
      'Aumente Força ou Destreza em 1 (máx. 20). Você ganha proficiência com armaduras médias e escudos. // TODO: a proficiência de armadura só terá efeito mecânico quando o efeito mecânico das proficiências (A15) for implementado.',
    abilityChoice: { options: ['strength', 'dexterity'], amount: 1 },
  },
  {
    id: 'heavily-armored',
    name: 'Armadura Pesada',
    description:
      'Aumente Força em 1 (máx. 20). Você ganha proficiência com armaduras pesadas. // TODO: a proficiência de armadura só terá efeito mecânico quando o efeito mecânico das proficiências (A15) for implementado.',
    effects: [{ type: 'abilityBonus', ability: 'strength', value: 1, max: 20 }],
  },
  {
    id: 'medium-armor-master',
    name: 'Mestre de Armadura Média',
    description:
      'Aumente Destreza em 1 (máx. 20). Armaduras médias não impõem desvantagem em Furtividade e permitem somar até +3 de Destreza à CA. // TODO: o teto de Destreza da armadura média (+3) e a desvantagem em Furtividade dependem do sistema de armadura (A15).',
    effects: [{ type: 'abilityBonus', ability: 'dexterity', value: 1, max: 20 }],
  },
  {
    id: 'heavy-armor-master',
    name: 'Mestre de Armadura Pesada',
    description:
      'Aumente Força em 1 (máx. 20). Enquanto usa armadura pesada, dano contundente, cortante e perfurante é reduzido em 3. // TODO: a redução de dano por armadura pesada depende de um sistema de redução de dano inexistente.',
    effects: [{ type: 'abilityBonus', ability: 'strength', value: 1, max: 20 }],
  },
  {
    id: 'keen-mind',
    name: 'Mente Aguçada',
    description:
      'Aumente Inteligência em 1 (máx. 20). Você sempre sabe a direção do norte, quantas horas faltam para o próximo amanhecer e pode lembrar de qualquer coisa vista ou ouvida no último mês.',
    effects: [{ type: 'abilityBonus', ability: 'intelligence', value: 1, max: 20 }],
  },
  {
    id: 'linguist',
    name: 'Linguista',
    description:
      'Aumente Inteligência em 1 (máx. 20). Você aprende três idiomas e pode criar cifras escritas que só quem você ensinar consegue decifrar. // TODO: os três idiomas do talento dependem de um pipeline de idioma por talento (hoje os idiomas vêm só de raça/antecedente).',
    effects: [{ type: 'abilityBonus', ability: 'intelligence', value: 1, max: 20 }],
  },
  {
    id: 'skulker',
    name: 'Furtivo',
    description:
      'Aumente Destreza em 1 (máx. 20). Você pode se esconder mesmo com pouca cobertura, não é percebido por visão no escuro a longa distância e erra o alvo sem revelar a posição.',
    effects: [{ type: 'abilityBonus', ability: 'dexterity', value: 1, max: 20 }],
  },
  {
    id: 'tavern-brawler',
    name: 'Brutamontes de Taverna',
    description:
      'Aumente Força ou Constituição em 1 (máx. 20). Você é proficiente em ataques desarmados e armas improvisadas, e pode agarrar como ação bônus após acertar. // TODO (Fase 5 — motor de ações): o agarrar como ação bônus depende do motor de ações.',
    abilityChoice: { options: ['strength', 'constitution'], amount: 1 },
  },
  {
    id: 'weapon-master',
    name: 'Mestre de Armas',
    description:
      'Aumente Força ou Destreza em 1 (máx. 20). Você ganha proficiência com quatro armas simples ou marciais à sua escolha. // TODO: a proficiência de arma só terá efeito mecânico quando o efeito mecânico das proficiências (A15) for implementado.',
    abilityChoice: { options: ['strength', 'dexterity'], amount: 1 },
  },
  {
    id: 'resilient',
    name: 'Resiliente',
    description:
      'Escolha um atributo; aumente-o em 1 (máx. 20) e ganhe proficiência nas salvaguardas desse atributo.',
    abilityChoice: {
      options: ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'],
      amount: 1,
    },
    saveProficiency: true,
  },
  {
    id: 'tough',
    name: 'Vigoroso',
    description: 'Aumente Constituição em 1 (máx. 20). Seus pontos de vida máximos aumentam em 2 por nível.',
    effects: [{ type: 'hpBonus', value: 2, perLevel: true }],
  },
  {
    id: 'mobile',
    name: 'Móvel',
    description:
      'Seu deslocamento aumenta em 3 m; terreno difícil não custa movimento extra ao Disparar e você não provoca ataques de oportunidade ao se mover depois de atacar. // TODO (Fase 5 — motor de ações): as cláusulas de Disparar/ataque de oportunidade dependem do motor de ações.',
    effects: [{ type: 'speed', value: 3 }],
  },
  // --- Categoria B -----------------------------------------------------------
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
  // --- Categoria C -----------------------------------------------------------
  {
    id: 'elemental-adept',
    name: 'Adepto Elemental',
    description:
      'Escolha um tipo de dano (ácido, frio, fogo, elétrico ou trovejante): suas magias ignoram resistência a ele e tratam imunidade como resistência. // TODO: depende do sistema de resistência/imunidade por parcela de dano de magia (A7) e da escolha do tipo de dano.',
    effects: [{ type: 'other' }],
  },
  {
    id: 'lucky',
    name: 'Sortudo',
    description:
      'Você tem 3 pontos de sorte. Pode gastar 1 para rolar um dado adicional em um ataque, teste ou salvaguarda seu, ou para forçar a rerrolagem de um ataque contra você. // TODO: depende de um recurso com gasto e de uma escolha interativa na rolagem (o luckyReroll automático do Halfling não cobre).',
    effects: [{ type: 'other' }],
  },
  {
    id: 'magic-initiate',
    name: 'Iniciação em Magia',
    description:
      'Escolha uma classe: você aprende dois truques e uma magia de 1º nível dela, usando o atributo de conjuração dessa classe. // TODO: depende do catálogo de magias (ainda incompleto) e de magias por talento.',
    effects: [{ type: 'other' }],
  },
  {
    id: 'ritual-caster',
    name: 'Conjurador Ritual',
    description:
      'Você aprende duas magias ritualísticas de 1º nível de uma classe escolhida e pode copiar outras magias ritualísticas que encontrar. // TODO: depende do catálogo de magias e do sistema de rituais.',
    effects: [{ type: 'other' }],
  },
  {
    id: 'spell-sniper',
    name: 'Atirador de Magias',
    description:
      'Suas magias de ataque dobram o alcance e ignoram cobertura parcial e três quartos. Aprender uma magia que exige ataque não precisa ser de perto. // TODO: depende do catálogo de magias e do sistema de alcance/cobertura.',
    effects: [{ type: 'other' }],
  },
  {
    id: 'war-caster',
    name: 'Conjurador de Guerra',
    description:
      'Você tem vantagem em salvaguardas de Constituição para manter concentração, pode conjurar com as mãos ocupadas e pode fazer gestos somáticos mesmo com armas e escudo. // TODO (Fase 5 — motor de ações): a concentração e a conjuração com as mãos ocupadas dependem do motor de conjuração.',
    effects: [{ type: 'other' }],
  },
  {
    id: 'skilled',
    name: 'Habilidoso',
    description:
      'Você ganha proficiência em quaisquer três perícias ou ferramentas. // TODO: depende de uma sub-escolha de três perícias/ferramentas concedida por talento (o skillProficiency existe, mas é race-only e fora do derived).',
    effects: [{ type: 'other' }],
  },
  {
    id: 'observant',
    name: 'Observador',
    description:
      'Aumente Inteligência ou Sabedoria em 1 (máx. 20). Você lê lábios e ganha +5 em Percepção e Investigação passivas. // TODO: o +5 nas passivas depende de um efeito de Percepção/Investigação passiva (hoje só a Percepção passiva é calculada, e não há bônus de perícia por talento).',
    abilityChoice: { options: ['intelligence', 'wisdom'], amount: 1 },
  },
  {
    id: 'alert',
    name: 'Alerta',
    description:
      'Você ganha +5 na iniciativa, não pode ser surpreendido enquanto estiver consciente e criaturas ocultas não têm vantagem nos ataques contra você. // TODO: o +5 na iniciativa depende de um efeito de bônus de iniciativa (o tipo "bonus" existe, mas não é processado); a imunidade a surpresa depende do motor de combate.',
    effects: [{ type: 'other' }],
  },
];

/** Busca um talento pelo id estável. */
export function getFeat(id: string): FeatDefinition | undefined {
  return FEATS.find((feat) => feat.id === id);
}

/** Busca um talento pelo nome em português. */
export function findFeatByName(name: string): FeatDefinition | undefined {
  const target = name.trim().toLowerCase();
  return FEATS.find((feat) => feat.name.toLowerCase() === target);
}
