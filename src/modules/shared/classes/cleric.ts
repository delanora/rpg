import type {
  ClassDefinition,
  ClassFeatureDefinition,
  SubclassDefinition,
} from './types.js';

/**
 * Clérigo (Cleric) — PHB 2014.
 *
 * O clérigo escolhe o Domínio Divino JÁ no nível 1 — é uma das três classes em
 * que a subclasse faz parte do pacote inicial (as outras são o Feiticeiro e o
 * Bruxo). Por isso o assistente de criação pede o domínio no passo da classe.
 *
 * CANALIZAR DIVINDADE: as opções são TOGGLES que gastam o recurso de mesmo id
 * (padrão do Ki do monge) — não se "escolhe" a opção de forma permanente, ela
 * fica sempre disponível. Os usos seguem o PHB 2014: 1 no 2º nível, 2 no 6º e 3
 * no 18º, recuperados num descanso curto ou longo.
 *
 * MAGIAS DE DOMÍNIO: ficam SEMPRE preparadas e NÃO contam no limite de magias
 * preparadas. O catálogo de magias ainda não existe (ver REVISAO-CODIGO.md), então
 * entram como TEXTO na ficha, na faixa de nível em que cada par é liberado — a
 * mesma decisão das Magias de Juramento do paladino e das magias inatas de raça.
 */

// ---------------------------------------------------------------------------
// Características de CLASSE
// ---------------------------------------------------------------------------

/**
 * Recurso "Canalizar Divindade" (classe): 1 uso no 2º nível, 2 no 6º e 3 no 18º,
 * recuperado num descanso curto ou longo. É o mesmo padrão de contador do Ki/Fúria.
 */
const CHANNEL_DIVINITY_RESOURCE = {
  type: 'resource' as const,
  id: 'channel-divinity',
  name: 'Canalizar Divindade',
  resource: {
    name: 'Canalizar Divindade',
    recharge: 'short' as const,
    maxByLevel: [
      { level: 2, value: 1 },
      { level: 6, value: 2 },
      { level: 18, value: 3 },
    ],
  },
};

/**
 * Uma opção de Canalizar Divindade: um toggle que GASTA o recurso
 * `channel-divinity` (como as opções de Ki do monge).
 */
function channelDivinityOption(id: string, name: string) {
  return { type: 'toggle' as const, id, name, resourceId: 'channel-divinity' };
}

/** Recurso de uso limitado por Sabedoria (Lampejo Protetor, Sacerdote de Guerra...). */
function wisdomUsesResource(id: string, name: string) {
  return {
    type: 'resource' as const,
    id,
    name,
    resource: { name, recharge: 'long' as const, abilityMod: 'wisdom' as const, min: 1 },
  };
}

const CLERIC_FEATURES: ClassFeatureDefinition[] = [
  {
    id: 'channel-divinity',
    name: 'Canalizar Divindade',
    level: 2,
    description:
      'Você canaliza energia divina para alimentar efeitos mágicos. Usos: 1 (nível 2), 2 (nível 6) e 3 (nível 18); recuperados num descanso curto ou longo. A CD da sua Canalizar Divindade é 8 + o seu bônus de proficiência + o seu modificador de Sabedoria. Cada opção aparece na ficha como uma ação que gasta 1 uso.',
    effect: CHANNEL_DIVINITY_RESOURCE,
  },
  {
    id: 'turn-undead',
    name: 'Expulsar Mortos-Vivos',
    level: 2,
    description:
      'Como ação, você apresenta o seu símbolo sagrado e cada morto-vivo a até 9 m (30 pés) que possa ver ou ouvir você faz uma salvaguarda de Sabedoria. Se falhar, a criatura fica amedrontada por 1 minuto ou até sofrer dano. Gasta 1 uso de Canalizar Divindade.',
    effect: channelDivinityOption('turn-undead', 'Expulsar Mortos-Vivos'),
  },
  {
    id: 'destroy-undead',
    name: 'Destruir Mortos-Vivos',
    level: 5,
    description:
      'Ao usar Expulsar Mortos-Vivos, mortos-vivos de CR igual ou abaixo do limiar que falharem na salvaguarda são destruídos em vez de apenas amedrontados. Limiar por nível de clérigo: 5º nível = CR 1/2, 8º = CR 1, 11º = CR 2, 14º = CR 3 e 17º = CR 4.',
    // TODO(Fase 5): aplicar o CR automaticamente exige o motor de criaturas em combate.
  },
  {
    id: 'divine-intervention',
    name: 'Intervenção Divina',
    level: 10,
    description:
      'Como ação, role 1d100 e compare com o seu nível de clérigo: se o resultado for IGUAL ou MENOR que o nível, a sua divindade intervém — o mestre escolhe o efeito (qualquer magia de clérigo ou de domínio, por exemplo). Se você tiver sucesso, não pode usar de novo por 7 dias; se falhar, só pode tentar de novo depois de um descanso longo. O efeito em si é narrativo e fica a critério do mestre.',
    effect: {
      type: 'resource',
      id: 'divine-intervention',
      name: 'Intervenção Divina',
      resource: { name: 'Intervenção Divina', recharge: 'long', max: 1 },
    },
  },
  {
    id: 'improved-divine-intervention',
    name: 'Intervenção Divina Aprimorada',
    level: 20,
    description:
      'A sua Intervenção Divina funciona automaticamente: não é preciso rolar o d100 e o pedido é atendido sem chance de falha.',
  },
];

// ---------------------------------------------------------------------------
// Domínios Divinos (subclasse escolhida no 1º nível)
// ---------------------------------------------------------------------------

/**
 * Uma faixa de MAGIAS DE DOMÍNIO (sempre preparadas, fora do limite). O catálogo
 * de magias ainda não existe, então o vínculo real fica para a Fase 4.
 */
function domainSpellsFeature(
  id: string,
  level: number,
  spells: string,
): ClassFeatureDefinition {
  return {
    id,
    name: 'Magias de Domínio',
    level,
    description:
      `Estas magias ficam SEMPRE preparadas e não contam no limite de magias preparadas. ${level}º nível: ${spells}.`,
    // TODO(catálogo de magias): quando `shared/spells/` existir, ligar estas
    // magias como "sempre preparadas" fora do limite — mesma decisão das Magias
    // de Juramento do paladino (hoje só texto, sem tipo de efeito novo).
  };
}

/** Perícias concedidas por um domínio (o jogador escolhe `count` entre `options`). */
// TODO(escolha na criação): as perícias de Domínio (Conhecimento/Natureza) são
// escolhidas no 1º nível. A criação ainda não resolve escolhas de SUBCLASSE no
// passo da classe (o `resolveFeatureChoices` do passo 5 passa a subclasse vazia),
// então ficam descritas aqui — o vínculo interativo depende desse encaixe.

const CLERIC_SUBCLASSES: SubclassDefinition[] = [
  {
    id: 'life',
    name: 'Domínio da Vida',
    description:
      'A energia positiva que sustenta toda a existência é a sua devoção: suas curas são reforçadas e você mantém os aliados de pé.',
    // Proficiência Bônus: armadura pesada.
    proficiencies: { armor: ['Armaduras pesadas'], weapons: [], tools: [] },
    features: [
      {
        id: 'life-disciple-of-life',
        name: 'Bênção do Discípulo',
        level: 1,
        description:
          'As suas magias de cura são mais eficazes: sempre que usar uma magia de 1º nível ou superior para restaurar pontos de vida de uma criatura, ela recupera pontos de vida adicionais iguais a 2 + o nível da magia.',
        // TODO(catálogo de magias): o bônus só é aplicável quando as magias de
        // cura existirem no catálogo (Fase 4).
      },
      domainSpellsFeature(
        'life-domain-spells',
        1,
        'Bênção, Curar Ferimentos',
      ),
      domainSpellsFeature('life-domain-spells-3', 3, 'Restauração Menor, Arma Espiritual'),
      domainSpellsFeature('life-domain-spells-5', 5, 'Farol da Esperança, Revivificar'),
      domainSpellsFeature(
        'life-domain-spells-7',
        7,
        'Proteção contra a Morte, Guardião da Fé',
      ),
      domainSpellsFeature(
        'life-domain-spells-9',
        9,
        'Curar Ferimentos em Massa, Ressuscitar',
      ),
      {
        id: 'life-preserve-life',
        name: 'Canalizar Divindade: Preservar a Vida',
        level: 2,
        description:
          'Como ação, você apresenta o seu símbolo sagrado e distribui pontos de vida iguais a 5 × o seu nível de clérigo entre criaturas a até 9 m (30 pés). Nenhuma criatura pode ser curada acima da metade do seu máximo, e a opção não afeta mortos-vivos nem constructos. Gasta 1 uso de Canalizar Divindade.',
        effect: channelDivinityOption('preserve-life', 'Preservar a Vida'),
      },
      {
        id: 'life-blessed-healer',
        name: 'Curandeiro Abençoado',
        level: 6,
        description:
          'As curas que você faz nos outros também curam você: ao lançar uma magia de 1º nível ou superior que restaure pontos de vida de outra criatura, você recupera pontos de vida iguais a 2 + o nível da magia.',
        // TODO(catálogo de magias): depende das magias de cura (Fase 4).
      },
      {
        id: 'life-divine-strike',
        name: 'Golpe Divino',
        level: 8,
        description:
          'Uma vez em cada um dos seus turnos, quando acertar uma criatura com um ataque com arma, você pode causar 1d8 de dano radiante extra (2d8 a partir do 14º nível).',
        // TODO(Fase 5): dano extra por ataque no motor de combate.
      },
      {
        id: 'life-supreme-healing',
        name: 'Cura Suprema',
        level: 17,
        description:
          'Quando for rolar um ou mais dados para restaurar pontos de vida com uma magia, você usa o maior valor possível de cada dado (em vez de rolar).',
        // TODO(catálogo de magias): depende das magias de cura (Fase 4).
      },
    ],
  },
  {
    id: 'light',
    name: 'Domínio da Luz',
    description:
      'Você canaliza a luz purificadora, incinerando as trevas e protegendo os seus com lampejos radiantes.',
    features: [
      {
        id: 'light-bonus-cantrip',
        name: 'Truque Bônus',
        level: 1,
        description:
          'Você aprende o truque Luz, se ainda não o conhecer. Ele não conta no número de truques de clérigo que você conhece.',
        // TODO(catálogo de magias): ligar o truque Luz quando o catálogo existir.
      },
      {
        id: 'light-warding-flare',
        name: 'Lampejo Protetor',
        level: 1,
        description:
          'Quando for atacado por uma criatura a até 9 m (30 pés) que você possa ver, você usa a reação para impor desvantagem na rolagem de ataque dela. Você pode usar um número de vezes igual ao seu modificador de Sabedoria (mínimo 1); recupera tudo num descanso longo. Uma criatura que não possa ser cegada é imune.',
        effect: wisdomUsesResource('warding-flare', 'Lampejo Protetor'),
      },
      domainSpellsFeature('light-domain-spells', 1, 'Mãos Flamejantes, Fogo das Fadas'),
      domainSpellsFeature(
        'light-domain-spells-3',
        3,
        'Esfera Flamejante, Raio Escaldante',
      ),
      domainSpellsFeature('light-domain-spells-5', 5, 'Luz do Dia, Bola de Fogo'),
      domainSpellsFeature('light-domain-spells-7', 7, 'Guardião da Fé, Muralha de Fogo'),
      domainSpellsFeature('light-domain-spells-9', 9, 'Coluna de Chamas, Vidência'),
      {
        id: 'light-radiance-of-the-dawn',
        name: 'Canalizar Divindade: Radiância da Aurora',
        level: 2,
        description:
          'Como ação, você apresenta o seu símbolo sagrado: qualquer escuridão MÁGICA a até 9 m (30 pés) é dissipada e cada criatura hostil na área faz uma salvaguarda de Constituição, sofrendo 2d10 + o seu nível de clérigo de dano radiante se falhar (metade se passar). Criaturas com cobertura total não são afetadas. Gasta 1 uso de Canalizar Divindade.',
        effect: channelDivinityOption('radiance-of-the-dawn', 'Radiância da Aurora'),
      },
      {
        id: 'light-improved-flare',
        name: 'Lampejo Aprimorado',
        level: 6,
        description:
          'Você também pode usar o Lampejo Protetor quando uma criatura a até 9 m (30 pés) que você possa ver atacar alguém que não seja você.',
      },
      {
        id: 'light-potent-spellcasting',
        name: 'Conjuração Potente',
        level: 8,
        description:
          'Você soma o seu modificador de Sabedoria ao dano de qualquer truque de clérigo.',
        // TODO(catálogo de magias): o bônus só é aplicável com os truques (Fase 4).
      },
      {
        id: 'light-corona-of-light',
        name: 'Coroa de Luz',
        level: 17,
        description:
          'Como ação, você ativa uma aura de luz solar por 1 minuto (ou até dispensá-la): emite luz plena a 18 m (60 pés) e penumbra a mais 9 m (30 pés), e os inimigos na luz plena têm desvantagem nas salvaguardas contra magias que causem dano de fogo ou radiante.',
        // TODO(catálogo de magias): a desvantagem só vale para magias (Fase 4).
      },
    ],
  },
  {
    id: 'knowledge',
    name: 'Domínio do Conhecimento',
    description:
      'O saber é uma forma de devoção: idiomas, novas perícias e a leitura do que os outros escondem.',
    features: [
      {
        id: 'knowledge-blessings-of-knowledge',
        name: 'Bênçãos do Conhecimento',
        level: 1,
        description:
          'Você aprende dois idiomas à sua escolha e ganha proficiência em duas perícias à sua escolha entre Arcanismo, História, Natureza e Religião. O seu bônus de proficiência é DOBRADO em qualquer teste que use uma dessas duas perícias.',
        // TODO(escolha na criação): 2 idiomas + 2 perícias (Arcanismo/História/
        // Natureza/Religião) com Expertise — depende de escolha de subclasse no
        // passo da classe da criação (ver o TODO acima dos domínios).
      },
      domainSpellsFeature('knowledge-domain-spells', 1, 'Comando, Identificar'),
      domainSpellsFeature('knowledge-domain-spells-3', 3, 'Augúrio, Sugestão'),
      domainSpellsFeature(
        'knowledge-domain-spells-5',
        5,
        'Não Detecção, Falar com os Mortos',
      ),
      domainSpellsFeature('knowledge-domain-spells-7', 7, 'Olho Arcano, Confusão'),
      domainSpellsFeature('knowledge-domain-spells-9', 9, 'Lenda, Vidência'),
      {
        id: 'knowledge-knowledge-of-the-ages',
        name: 'Canalizar Divindade: Conhecimento dos Séculos',
        level: 2,
        description:
          'Como ação, você toca num poço divino de saber: escolha uma perícia ou ferramenta e fique proficiente nela por 10 minutos. Gasta 1 uso de Canalizar Divindade.',
        effect: channelDivinityOption('knowledge-of-the-ages', 'Conhecimento dos Séculos'),
      },
      {
        id: 'knowledge-read-thoughts',
        name: 'Canalizar Divindade: Leitura dos Pensamentos',
        level: 6,
        description:
          'Como ação, escolha uma criatura que você possa ver a até 18 m (60 pés): ela faz uma salvaguarda de Sabedoria. Se falhar, você lê os pensamentos superficiais dela por 1 minuto e, nesse período, pode usar a ação para encerrar o efeito e lançar Sugestão nela sem gastar espaço de magia (o alvo falha automaticamente). Se passar, não pode ser alvo de novo por um descanso longo. Gasta 1 uso de Canalizar Divindade.',
        effect: channelDivinityOption('read-thoughts', 'Leitura dos Pensamentos'),
        // TODO(catálogo de magias): lançar Sugestão sem gastar espaço (Fase 4).
      },
      {
        id: 'knowledge-potent-spellcasting',
        name: 'Conjuração Potente',
        level: 8,
        description:
          'Você soma o seu modificador de Sabedoria ao dano de qualquer truque de clérigo.',
        // TODO(catálogo de magias): o bônus só é aplicável com os truques (Fase 4).
      },
      {
        id: 'knowledge-visions-of-the-past',
        name: 'Visões do Passado',
        level: 17,
        description:
          'Meditando por 1 minuto (concentração, como se lançasse uma magia), você recebe visões do passado de um objeto que segura (Leitura de Objeto) ou do ambiente ao redor (Leitura de Área), voltando até um número de dias igual à sua Sabedoria. Recupera-se num descanso curto ou longo.',
        effect: {
          type: 'resource',
          id: 'visions-of-the-past',
          name: 'Visões do Passado',
          resource: { name: 'Visões do Passado', recharge: 'short', max: 1 },
        },
      },
    ],
  },
  {
    id: 'nature',
    name: 'Domínio da Natureza',
    description:
      'Você serve às forças do mundo natural, aprendendo um truque druídico e falando com animais e plantas.',
    // Proficiência Bônus: armadura pesada.
    proficiencies: { armor: ['Armaduras pesadas'], weapons: [], tools: [] },
    features: [
      {
        id: 'nature-acolyte-of-nature',
        name: 'Acólito da Natureza',
        level: 1,
        description:
          'Você aprende um truque à sua escolha da lista do druida (ele conta como truque de clérigo e não ocupa o limite de truques). Você também ganha proficiência numa perícia à sua escolha entre Adestrar Animais, Natureza ou Sobrevivência.',
        // TODO(catálogo de magias): ligar o truque do druida (Fase 4).
        // TODO(escolha na criação): a perícia depende de escolha de subclasse no
        // passo da classe da criação (ver o TODO acima dos domínios).
      },
      domainSpellsFeature('nature-domain-spells', 1, 'Amizade Animal, Falar com Animais'),
      domainSpellsFeature('nature-domain-spells-3', 3, 'Pele de Casca, Crescer Espinhos'),
      domainSpellsFeature('nature-domain-spells-5', 5, 'Crescer Plantas, Muralha de Vento'),
      domainSpellsFeature('nature-domain-spells-7', 7, 'Dominar Fera, Vinha Agarradora'),
      domainSpellsFeature('nature-domain-spells-9', 9, 'Praga de Insetos, Passo de Árvore'),
      {
        id: 'nature-charm-animals-and-plants',
        name: 'Canalizar Divindade: Encantar Animais e Plantas',
        level: 2,
        description:
          'Como ação, você apresenta o seu símbolo sagrado: cada criatura do tipo fera ou planta que possa ver você a até 9 m (30 pés) faz uma salvaguarda de Sabedoria. Se falhar, fica enfeitiçada por 1 minuto ou até sofrer dano (enquanto enfeitiçada, é amistosa com você e com quem você indicar). Gasta 1 uso de Canalizar Divindade.',
        effect: channelDivinityOption(
          'charm-animals-and-plants',
          'Encantar Animais e Plantas',
        ),
      },
      {
        id: 'nature-dampen-elements',
        name: 'Amainar Elementos',
        level: 6,
        description:
          'Quando você ou uma criatura a até 9 m (30 pés) sofre dano de ácido, frio, fogo, elétrico ou trovejante, você usa a reação para dar resistência à criatura contra aquela ocorrência de dano.',
      },
      {
        id: 'nature-divine-strike',
        name: 'Golpe Divino',
        level: 8,
        description:
          'Uma vez em cada um dos seus turnos, quando acertar uma criatura com um ataque com arma, você pode causar 1d8 de dano extra de frio, fogo ou elétrico (à sua escolha) — 2d8 a partir do 14º nível.',
        // TODO(Fase 5): dano extra por ataque no motor de combate.
      },
      {
        id: 'nature-master-of-nature',
        name: 'Mestre da Natureza',
        level: 17,
        description:
          'Enquanto houver criaturas enfeitiçadas pela sua opção Encantar Animais e Plantas, você pode usar uma ação bônus para comandar verbalmente o que cada uma fará no próximo turno.',
      },
    ],
  },
  {
    id: 'tempest',
    name: 'Domínio da Tempestade',
    description:
      'A fúria do trovão é sua: relâmpagos, estrondos e o castigo de quem ousa tocá-lo.',
    // Proficiências Bônus: armas marciais e armadura pesada.
    proficiencies: { armor: ['Armaduras pesadas'], weapons: ['Armas marciais'], tools: [] },
    features: [
      {
        id: 'tempest-wrath-of-the-storm',
        name: 'Fúria da Tempestade',
        level: 1,
        description:
          'Quando uma criatura a até 1,5 m (5 pés) que você possa ver o acertar com um ataque, você usa a reação para forçá-la a uma salvaguarda de Destreza: ela sofre 2d8 de dano elétrico ou trovejante (à sua escolha) se falhar, ou metade se passar. Usos iguais ao seu modificador de Sabedoria (mínimo 1); recupera tudo num descanso longo.',
        effect: wisdomUsesResource('wrath-of-the-storm', 'Fúria da Tempestade'),
      },
      domainSpellsFeature('tempest-domain-spells', 1, 'Nuvem de Neblina, Onda Trovejante'),
      domainSpellsFeature('tempest-domain-spells-3', 3, 'Rajada de Vento, Despedaçar'),
      domainSpellsFeature(
        'tempest-domain-spells-5',
        5,
        'Invocar Relâmpagos, Tempestade de Granizo',
      ),
      domainSpellsFeature('tempest-domain-spells-7', 7, 'Controlar Água, Tempestade de Gelo'),
      domainSpellsFeature('tempest-domain-spells-9', 9, 'Onda Destrutiva, Praga de Insetos'),
      {
        id: 'tempest-destructive-wrath',
        name: 'Canalizar Divindade: Ira Destrutiva',
        level: 2,
        description:
          'Quando for rolar dano elétrico ou trovejante, você usa a Canalizar Divindade para causar o dano MÁXIMO em vez de rolar os dados. Gasta 1 uso de Canalizar Divindade.',
        effect: channelDivinityOption('destructive-wrath', 'Ira Destrutiva'),
      },
      {
        id: 'tempest-thunderous-strike',
        name: 'Golpe Trovejante',
        level: 6,
        description:
          'Quando você causa dano elétrico a uma criatura de tamanho Grande ou menor, pode empurrá-la até 3 m (10 pés) para longe de você.',
      },
      {
        id: 'tempest-divine-strike',
        name: 'Golpe Divino',
        level: 8,
        description:
          'Uma vez em cada um dos seus turnos, quando acertar uma criatura com um ataque com arma, você pode causar 1d8 de dano trovejante extra (2d8 a partir do 14º nível).',
        // TODO(Fase 5): dano extra por ataque no motor de combate.
      },
      {
        id: 'tempest-stormborn',
        name: 'Nascido da Tempestade',
        level: 17,
        description:
          'Você ganha deslocamento de voo igual ao seu deslocamento de caminhada quando não estiver no subsolo nem em ambientes fechados.',
        // TODO(Fase 5): deslocamento de voo condicional ainda não é modelado.
      },
    ],
  },
  {
    id: 'trickery',
    name: 'Domínio do Engano',
    description:
      'Seu padroeiro é o embusteiro: ilusões, disfarces e a graça de passar despercebido.',
    features: [
      {
        id: 'trickery-blessing-of-the-trickster',
        name: 'Bênção do Embusteiro',
        level: 1,
        description:
          'Como ação, você toca numa criatura voluntária (que não seja você) e concede vantagem nos testes de Destreza (Furtividade) dela por 1 hora, ou até você usar esta característica de novo.',
      },
      domainSpellsFeature(
        'trickery-domain-spells',
        1,
        'Enfeitiçar Pessoa, Disfarçar-se',
      ),
      domainSpellsFeature(
        'trickery-domain-spells-3',
        3,
        'Imagem Espelhada, Passar sem Deixar Rastros',
      ),
      domainSpellsFeature('trickery-domain-spells-5', 5, 'Piscar, Dissipar Magia'),
      domainSpellsFeature(
        'trickery-domain-spells-7',
        7,
        'Porta Dimensional, Metamorfose',
      ),
      domainSpellsFeature(
        'trickery-domain-spells-9',
        9,
        'Dominar Pessoa, Modificar Memória',
      ),
      {
        id: 'trickery-invoke-duplicity',
        name: 'Canalizar Divindade: Invocar Duplicidade',
        level: 2,
        description:
          'Como ação, você cria uma ilusão perfeita de si mesmo num espaço desocupado a até 9 m (30 pés), que dura 1 minuto (ou até perder a concentração, como numa magia). Com uma ação bônus você move a ilusão até 9 m (30 pés). Enquanto você e a ilusão estiverem a até 1,5 m (5 pés) de uma criatura que veja a ilusão, você tem vantagem nos ataques contra ela. Gasta 1 uso de Canalizar Divindade.',
        effect: channelDivinityOption('invoke-duplicity', 'Invocar Duplicidade'),
      },
      {
        id: 'trickery-cloak-of-shadows',
        name: 'Canalizar Divindade: Manto de Sombras',
        level: 6,
        description:
          'Como ação, você fica invisível até o fim do seu próximo turno; a invisibilidade acaba se você atacar ou lançar uma magia. Gasta 1 uso de Canalizar Divindade.',
        effect: channelDivinityOption('cloak-of-shadows', 'Manto de Sombras'),
      },
      {
        id: 'trickery-divine-strike',
        name: 'Golpe Divino',
        level: 8,
        description:
          'Uma vez em cada um dos seus turnos, quando acertar uma criatura com um ataque com arma, você pode causar 1d8 de dano de veneno extra (2d8 a partir do 14º nível).',
        // TODO(Fase 5): dano extra por ataque no motor de combate.
      },
      {
        id: 'trickery-improved-duplicity',
        name: 'Duplicidade Aprimorada',
        level: 17,
        description:
          'Você cria até quatro duplicatas (em vez de uma) ao usar Invocar Duplicidade e, com uma ação bônus, pode mover qualquer número delas até 9 m (30 pés), a até 36 m (120 pés) de você.',
      },
    ],
  },
  {
    id: 'war',
    name: 'Domínio da Guerra',
    description:
      'Você luta pelo seu deus: treinamento marcial, armas sagradas e golpes extras em nome da fé.',
    // Proficiências Bônus: armas marciais e armadura pesada.
    proficiencies: { armor: ['Armaduras pesadas'], weapons: ['Armas marciais'], tools: [] },
    features: [
      {
        id: 'war-priest',
        name: 'Sacerdote de Guerra',
        level: 1,
        description:
          'Quando usa a ação de Ataque, você pode fazer um ataque com arma como ação bônus. Usos iguais ao seu modificador de Sabedoria (mínimo 1); recupera tudo num descanso longo.',
        effect: wisdomUsesResource('war-priest', 'Sacerdote de Guerra'),
      },
      domainSpellsFeature('war-domain-spells', 1, 'Favor Divino, Escudo da Fé'),
      domainSpellsFeature('war-domain-spells-3', 3, 'Arma Mágica, Arma Espiritual'),
      domainSpellsFeature(
        'war-domain-spells-5',
        5,
        'Manto do Cruzado, Guardiões Espirituais',
      ),
      domainSpellsFeature(
        'war-domain-spells-7',
        7,
        'Liberdade de Movimento, Pele de Pedra',
      ),
      domainSpellsFeature('war-domain-spells-9', 9, 'Coluna de Chamas, Dominar Monstro'),
      {
        id: 'war-guided-strike',
        name: 'Canalizar Divindade: Golpe Guiado',
        level: 2,
        description:
          'Quando fizer uma rolagem de ataque, você usa a Canalizar Divindade para somar +10 à rolagem — a escolha é feita depois de ver o dado, mas antes de saber se acertou ou errou. Gasta 1 uso de Canalizar Divindade.',
        effect: channelDivinityOption('guided-strike', 'Golpe Guiado'),
      },
      {
        id: 'war-gods-blessing',
        name: 'Canalizar Divindade: Bênção do Deus da Guerra',
        level: 6,
        description:
          'Quando uma criatura a até 9 m (30 pés) fizer uma rolagem de ataque, você usa a reação para somar +10 a ela, gastando 1 uso de Canalizar Divindade. A escolha é feita depois de ver o dado, mas antes de saber se acertou ou errou.',
        effect: channelDivinityOption('war-gods-blessing', 'Bênção do Deus da Guerra'),
      },
      {
        id: 'war-divine-strike',
        name: 'Golpe Divino',
        level: 8,
        description:
          'Uma vez em cada um dos seus turnos, quando acertar uma criatura com um ataque com arma, você pode causar 1d8 de dano extra do mesmo tipo do dano da arma (2d8 a partir do 14º nível).',
        // TODO(Fase 5): dano extra por ataque no motor de combate.
      },
      {
        id: 'war-avatar-of-battle',
        name: 'Avatar da Batalha',
        level: 17,
        description:
          'Você ganha resistência a dano contundente, perfurante e cortante de ataques NÃO mágicos.',
        effect: {
          type: 'resistance',
          damageTypes: ['Concussão', 'Perfurante', 'Cortante'],
          notes: 'Apenas de ataques não mágicos.',
        },
      },
    ],
  },
];

export const cleric: ClassDefinition = {
  key: 'cleric',
  name: 'Clérigo',
  description:
    'Servo de um poder divino: cura os seus e castiga os inimigos em nome do domínio que escolheu.',
  hitDie: 8,
  savingThrows: ['wisdom', 'charisma'],
  subclassLevel: 1, // Domínio Divino
  spellcasting: { type: 'full', ability: 'wisdom', learning: 'prepared' },
  features: CLERIC_FEATURES,
  subclasses: CLERIC_SUBCLASSES,
};
