import type { Race } from './types.js';

/**
 * Draconato (Dragonborn) — PHB 2014.
 *
 * Primeira raça do catálogo ESTRUTURADO (`shared/races/`). Ela já existia de
 * forma incompleta no `RACE_CATALOG` de `shared/creation.ts` (só os bônus de
 * atributo, sem a escolha de ancestralidade) — a origem do bug "Draconato não
 * consegue escolher a linhagem". Os dois catálogos COEXISTEM por enquanto: o
 * assistente de criação e o compêndio ainda leem o `RACE_CATALOG`; a
 * substituição é o Prompt 2.10.
 *
 * A ancestralidade dracônica é uma ESCOLHA obrigatória (`hasChoices` +
 * `raceChoices['draconic-ancestry']`). Declarada aqui só como DADO; a validação
 * de escolhas e a integração com o `derived` entram junto com o motor de raça.
 */
export const dragonborn: Race = {
  id: 'dragonborn',
  namePt: 'Draconato',
  nameEn: 'Dragonborn',
  abilityScoreIncrease: [
    { ability: 'strength', amount: 2 },
    { ability: 'charisma', amount: 1 },
  ],
  // 9 m = 30 pés (1 pé = 0,3 m, a conversão usada no sistema inteiro).
  speed: 9,
  size: 'Medium',
  // TODO: não há campo de idioma na ficha (só a intenção, aqui e no tipo).
  // Os idiomas ficam como texto informativo no traço de Ancestralidade.
  languages: ['Comum', 'Dracônico'],
  traits: [
    {
      id: 'draconic-ancestry',
      name: 'Ancestralidade Dracônica',
      description:
        'Você descende de uma linhagem de dragões. Escolha a sua ancestralidade ' +
        '(gravada em raceChoices["draconic-ancestry"]): ela define o TIPO DE DANO ' +
        'da sua Arma de Sopro e a Resistência a Dano. Tabela (cor · dano · sopro · ' +
        'salvaguarda): preto · Ácido · linha 1,5×9 m · Destreza; azul · Elétrico · ' +
        'linha 1,5×9 m · Destreza; latão · Fogo · linha 1,5×9 m · Destreza; bronze · ' +
        'Elétrico · linha 1,5×9 m · Destreza; cobre · Ácido · linha 1,5×9 m · ' +
        'Destreza; ouro · Fogo · cone 4,5 m · Destreza; verde · Veneno · cone 4,5 m · ' +
        'Constituição; vermelho · Fogo · cone 4,5 m · Destreza; prata · Frio · cone ' +
        '4,5 m · Constituição; branco · Frio · cone 4,5 m · Constituição. ' +
        'Você também fala, lê e escreve Comum e Dracônico.',
    },
    {
      id: 'breath-weapon',
      name: 'Arma de Sopro',
      description:
        'Com uma ação, você exala a energia da sua ancestralidade dracônica ' +
        '(veja a tabela no traço de Ancestralidade para o tipo de dano, o formato ' +
        '- linha de 1,5×9 m ou cone de 4,5 m - e a salvaguarda, Destreza ou ' +
        'Constituição). Quem falha sofre o dano inteiro; quem passa, metade. O dano ' +
        'escala pelo NÍVEL TOTAL DO PERSONAGEM: 2d6 (níveis 1-5), 3d6 (6-10), ' +
        '4d6 (11-15) e 5d6 (16-20). A CD da salvaguarda é 8 + bônus de proficiência ' +
        '+ modificador de Constituição (o mesmo cálculo de uma CD de magia). ' +
        'Recarrega após um descanso curto ou longo.',
      // Recarga: 1 uso que volta num descanso curto/longo. O contador é o único
      // pedaço automatizável hoje; os dados por nível total e a CD ficam no texto.
      mechanicalEffect: {
        type: 'resource',
        id: 'breath-weapon',
        name: 'Arma de Sopro',
        resource: { name: 'Arma de Sopro', max: 1, recharge: 'short' },
      },
    },
    {
      id: 'damage-resistance',
      name: 'Resistência a Dano',
      description:
        'Você tem resistência ao tipo de dano da sua ancestralidade dracônica ' +
        '(veja a tabela no traço de Ancestralidade).',
      // O tipo de dano NÃO é fixo: vem da ancestralidade escolhida.
      mechanicalEffect: {
        type: 'resistanceFromChoice',
        id: 'damage-resistance',
        choiceId: 'draconic-ancestry',
      },
    },
  ],
  // Sem sub-raças.
  hasChoices: [
    {
      id: 'draconic-ancestry',
      label: 'Ancestralidade Dracônica',
      options: [
        { id: 'black', label: 'Preto', damageType: 'Ácido' },
        { id: 'blue', label: 'Azul', damageType: 'Elétrico' },
        { id: 'brass', label: 'Latão', damageType: 'Fogo' },
        { id: 'bronze', label: 'Bronze', damageType: 'Elétrico' },
        { id: 'copper', label: 'Cobre', damageType: 'Ácido' },
        { id: 'gold', label: 'Ouro', damageType: 'Fogo' },
        { id: 'green', label: 'Verde', damageType: 'Veneno' },
        { id: 'red', label: 'Vermelho', damageType: 'Fogo' },
        { id: 'silver', label: 'Prata', damageType: 'Frio' },
        { id: 'white', label: 'Branco', damageType: 'Frio' },
      ],
    },
  ],
};
