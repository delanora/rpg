import type { Race } from './types.js';

/**
 * Gnomo (Gnome) — PHB 2014, com as duas sub-raças do Livro do Jogador: Gnomo da
 * Floresta e Gnomo das Rochas.
 *
 * Só DADOS por enquanto: a Astúcia Gnômica usa o novo tipo `saveAdvantage`
 * (INT/SAB/CAR contra magia) e a ferramenta do Gnomo das Rochas usa
 * `toolProficiency` — nenhum dos dois é aplicado à ficha ainda (motor de raça,
 * Prompt 2.10). `speed` em METROS (25 pés = 7,5 m).
 */
export const gnome: Race = {
  id: 'gnome',
  namePt: 'Gnomo',
  nameEn: 'Gnome',
  description:
    'Curiosos, engenhosos e vibrantes, os gnomos são pequenos inventores cheios de energia. ' +
    'Seu deslocamento é de 7,5 m (25 pés).',
  abilityScoreIncrease: [{ ability: 'intelligence', amount: 2 }],
  speed: 7.5,
  size: 'Small',
  // 18 m = 60 pés (visão no escuro).
  darkvision: 18,
  // TODO(idiomas): não há campo de idioma na ficha.
  languages: ['Comum', 'Gnômico'],
  traits: [
    {
      id: 'gnome-cunning',
      name: 'Astúcia Gnômica',
      description:
        'Você tem vantagem em todos os testes de resistência de Inteligência, Sabedoria e ' +
        'Carisma contra magia.',
      // Vantagem condicional em TRÊS salvaguardas com a mesma condição: um único
      // efeito `saveAdvantage` com a lista de atributos e a condição.
      mechanicalEffect: {
        type: 'saveAdvantage',
        id: 'gnome-cunning',
        name: 'Astúcia Gnômica',
        abilities: ['intelligence', 'wisdom', 'charisma'],
        condition: 'magic',
      },
    },
  ],
  subraces: [
    {
      id: 'forest-gnome',
      namePt: 'Gnomo da Floresta',
      abilityScoreIncrease: [{ ability: 'dexterity', amount: 1 }],
      traits: [
        {
          id: 'natural-illusionist',
          name: 'Ilusionista Natural',
          description:
            'Você conhece o truque Ilusão Menor. Inteligência é o atributo de conjuração dele.',
          // TODO(catálogo de magias): quando `shared/spells/` existir, declarar
          // hasChoices 'natural-illusionist' com spellsByClass('wizard', 0) e
          // refletir o truque em character.spells (mesmo caminho do Alto Elfo).
        },
        {
          id: 'speak-with-small-beasts',
          name: 'Falar com Pequenos Animais',
          description:
            'Por meio de sons e gestos, você pode comunicar ideias simples a Bestas de tamanho ' +
            'Pequeno ou menor.',
          // Textual: comunicação sem efeito mecânico modelado.
        },
      ],
    },
    {
      id: 'rock-gnome',
      namePt: 'Gnomo das Rochas',
      abilityScoreIncrease: [{ ability: 'constitution', amount: 1 }],
      traits: [
        {
          id: 'artificers-lore',
          name: 'Saber do Artífice',
          description:
            'Ao fazer um teste de Inteligência (História) relacionado a itens mágicos, ' +
            'alquímicos ou tecnológicos, você soma o dobro do seu bônus de proficiência.',
          // Textual: condição restrita não modelada.
        },
        {
          id: 'tinker',
          name: 'Proficiência com Ferramentas de Funileiro',
          description: 'Você tem proficiência com ferramentas de funileiro.',
          // Concessão DIRETA (sem escolha): o id da ferramenta vai no efeito. A
          // aplicação em `toolProficiencies` é do motor de raça (2.10).
          mechanicalEffect: { type: 'toolProficiency', target: 'tinker-tools' },
        },
        {
          id: 'rock-gnome-device',
          name: 'Capacidade de Construir Dispositivos',
          description:
            'Com as ferramentas de funileiro, você pode construir pequenos dispositivos ' +
            'mecânicos (brinquedo mecânico, isqueiro, caixa de música).',
          // TODO: construção livre de dispositivos — sem efeito mecânico modelado.
        },
      ],
    },
  ],
};
