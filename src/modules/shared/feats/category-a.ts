import type { Feat } from './types.js';

/**
 * Talentos de CATEGORIA A: efeito numérico simples, aplicado de verdade no
 * `derived` reaproveitando os tipos já existentes de `ClassFeatureEffect`
 * (`abilityBonus`, `save`, `hpBonus`, `speed`).
 *
 * Cláusulas secundárias que dependem de sistemas ainda inexistentes ficam como
 * TODO no próprio texto do talento (não são implementadas nesta etapa).
 */
export const CATEGORY_A_FEATS: readonly Feat[] = [
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
];
