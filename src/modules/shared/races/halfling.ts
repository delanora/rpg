import type { Race } from './types.js';

/**
 * Halfling — PHB 2014, com as duas sub-raças do Livro do Jogador: Pés-Leves e
 * Robusto.
 *
 * O **Sortudo** é o primeiro efeito racial AUTOMATIZADO no serviço de dados: o
 * traço declara `mechanicalEffect.type: 'luckyReroll'` e `rollTableDice` marca
 * `lucky: true` no resultado quando sai 1 natural num d20 de um personagem com
 * o Sortudo — a janela de dados oferece rolar de novo (ver `hasLuckyReroll` em
 * `index.ts`). O combate fica de fora por ora (o fluxo de ataque será revisto).
 *
 * `speed` em METROS (25 pés = 7,5 m). Halfling é Pequeno e NÃO tem visão no
 * escuro.
 */
export const halfling: Race = {
  id: 'halfling',
  namePt: 'Halfling',
  nameEn: 'Halfling',
  description:
    'Sortudos, corajosos e curiosos, os halflings são pequenos, ágeis e difíceis de ' +
    'assustar. Seu deslocamento é de 7,5 m (25 pés).',
  abilityScoreIncrease: [{ ability: 'dexterity', amount: 2 }],
  speed: 7.5,
  size: 'Small',
  // TODO(idiomas): não há campo de idioma na ficha; os idiomas ficam como texto.
  languages: ['Comum', 'Pequenino'],
  traits: [
    {
      id: 'lucky',
      name: 'Sortudo',
      description:
        'Quando você tira 1 natural num ataque, teste de habilidade ou teste de resistência, ' +
        'você pode rolar o dado de novo e deve usar o novo resultado.',
      // Efeito AUTOMATIZADO no pool de dados (ver hasLuckyReroll). Sem contador:
      // vale a cada 1 natural.
      mechanicalEffect: { type: 'luckyReroll', id: 'lucky', name: 'Sortudo' },
    },
    {
      id: 'brave',
      name: 'Corajoso',
      description: 'Você tem vantagem em testes de resistência para evitar ser amedrontado.',
      // Vantagem condicional em salvaguarda vai como 'other' (mesmo padrão do
      // Anão/Elfo): não há tipo de efeito próprio.
      mechanicalEffect: {
        type: 'other',
        id: 'brave',
        name: 'Corajoso',
        notes: 'Vantagem em salvaguardas contra ser amedrontado (condição restrita; sem tipo).',
      },
    },
    {
      id: 'halfling-nimbleness',
      name: 'Agilidade Halfling',
      description:
        'Você pode mover-se pelo espaço de qualquer criatura de tamanho Médio ou maior.',
      // Textual: mexer-se pelo espaço alheio é posicional e não é modelado.
    },
  ],
  subraces: [
    {
      id: 'lightfoot-halfling',
      namePt: 'Pés-Leves',
      abilityScoreIncrease: [{ ability: 'charisma', amount: 1 }],
      traits: [
        {
          id: 'naturally-stealthy',
          name: 'Furtivo por Natureza',
          description:
            'Você pode tentar se esconder mesmo quando estiver obscurecido apenas por uma ' +
            'criatura que seja pelo menos um tamanho maior que você.',
          // Textual: depende de posicionamento/obscurimento, não modelado.
        },
      ],
    },
    {
      id: 'stout-halfling',
      namePt: 'Robusto',
      abilityScoreIncrease: [{ ability: 'constitution', amount: 1 }],
      traits: [
        {
          id: 'stout-resilience',
          name: 'Resiliência Robusta',
          description:
            'Você tem vantagem em testes de resistência contra veneno e resistência a dano de ' +
            'veneno.',
          // MESMA estrutura da Resiliência Anã: dois efeitos (resistência
          // legível por máquina + vantagem como 'other') em mechanicalEffects.
          mechanicalEffects: [
            { type: 'resistance', damageTypes: ['Veneno'] },
            {
              type: 'other',
              id: 'stout-resilience',
              name: 'Resiliência Robusta',
              notes:
                'Vantagem em testes de resistência contra veneno (condição restrita; sem tipo).',
            },
          ],
        },
      ],
    },
  ],
};
