import type { Tool } from './types.js';

/**
 * Lista fechada das 35 ferramentas do PHB 2014.
 *
 * 17 artesão + 4 kits + 1 jogo + 9 instrumentos musicais + 1 navegação +
 * 1 ladrão + 2 veículos. O id de cada item é o valor gravado na ficha, então
 * NÃO renomeie um id já publicado — "thieves-tools", por exemplo, é referenciado
 * pela escolha de Expertise do Ladino.
 *
 * As descrições são resumos próprios (sem copiar o livro); o `defaultAbility`
 * é apenas a sugestão mais comum e não obriga nenhuma rolagem.
 */
export const TOOLS: readonly Tool[] = [
  // --- Ferramentas de Artesão (17) ------------------------------------------
  {
    id: 'alchemist-supplies',
    namePt: 'Suprimentos de Alquimista',
    nameEn: "Alchemist's Supplies",
    category: 'artisan',
    defaultAbility: 'INT',
    description:
      'Preparar substâncias químicas: ácidos, venenos simples, reagentes e itens como fogo alquímico e pólvora negra.',
  },
  {
    id: 'brewer-supplies',
    namePt: 'Ferramentas de Cervejeiro',
    nameEn: "Brewer's Supplies",
    category: 'artisan',
    defaultAbility: 'INT',
    description:
      'Produzir cerveja, vinho e outras bebidas fermentadas, além de identificar bebidas e perceber impurezas.',
  },
  {
    id: 'calligrapher-supplies',
    namePt: 'Ferramentas de Calígrafo',
    nameEn: "Calligrapher's Supplies",
    category: 'artisan',
    defaultAbility: 'DES',
    description:
      'Escrever com caligrafia refinada, adornar textos com iluminuras e falsificar manuscritos.',
  },
  {
    id: 'carpenter-tools',
    namePt: 'Ferramentas de Carpinteiro',
    nameEn: "Carpenter's Tools",
    category: 'artisan',
    defaultAbility: 'FOR',
    description:
      'Construir e reparar estruturas, móveis e objetos de madeira, e vedar portas ou passagens.',
  },
  {
    id: 'cartographer-tools',
    namePt: 'Ferramentas de Cartógrafo',
    nameEn: "Cartographer's Tools",
    category: 'artisan',
    defaultAbility: 'SAB',
    description:
      'Desenhar mapas precisos e estimar direções e distâncias a partir de pontos conhecidos.',
  },
  {
    id: 'cobbler-tools',
    namePt: 'Ferramentas de Sapateiro',
    nameEn: "Cobbler's Tools",
    category: 'artisan',
    defaultAbility: 'DES',
    description:
      'Costurar e consertar calçados, cintos e bolsas de couro.',
  },
  {
    id: 'cook-utensils',
    namePt: 'Utensílios de Cozinheiro',
    nameEn: "Cook's Utensils",
    category: 'artisan',
    defaultAbility: 'SAB',
    description:
      'Preparar refeições, melhorar o sabor de comida estragada e identificar temperos e venenos em alimentos.',
  },
  {
    id: 'glassblower-tools',
    namePt: 'Ferramentas de Vidreiro',
    nameEn: "Glassblower's Tools",
    category: 'artisan',
    defaultAbility: 'INT',
    description:
      'Soprar e moldar vidro para produzir garrafas, lentes e outros objetos delicados.',
  },
  {
    id: 'jeweler-tools',
    namePt: 'Ferramentas de Joalheiro',
    nameEn: "Jeweler's Tools",
    category: 'artisan',
    defaultAbility: 'INT',
    description:
      'Cortar, polir e engastar pedras preciosas, avaliar joias e identificar falsificações.',
  },
  {
    id: 'leatherworker-tools',
    namePt: 'Ferramentas de Curtidor',
    nameEn: "Leatherworker's Tools",
    category: 'artisan',
    defaultAbility: 'DES',
    description:
      'Curtir e costurar couro para produzir bolsas, arreios, calçados e peças de armadura leve.',
  },
  {
    id: 'mason-tools',
    namePt: 'Ferramentas de Pedreiro',
    nameEn: "Mason's Tools",
    category: 'artisan',
    defaultAbility: 'FOR',
    description:
      'Talhar e assentar pedra para erguer muros e estruturas, avaliando alvenaria e seus pontos fracos.',
  },
  {
    id: 'painter-supplies',
    namePt: 'Suprimentos de Pintor',
    nameEn: "Painter's Supplies",
    category: 'artisan',
    defaultAbility: 'SAB',
    description:
      'Pintar quadros e retratos, imitar obras existentes e reconhecer a autoria de uma pintura.',
  },
  {
    id: 'potter-tools',
    namePt: 'Ferramentas de Oleiro',
    nameEn: "Potter's Tools",
    category: 'artisan',
    defaultAbility: 'INT',
    description:
      'Moldar barro em potes, jarros e telhas e perceber o que já foi guardado num recipiente.',
  },
  {
    id: 'smith-tools',
    namePt: 'Ferramentas de Ferreiro',
    nameEn: "Smith's Tools",
    category: 'artisan',
    defaultAbility: 'FOR',
    description:
      'Forjar e reparar objetos de metal, como armas, armaduras e ferramentas.',
  },
  {
    id: 'tinker-tools',
    namePt: 'Ferramentas de Funileiro',
    nameEn: "Tinker's Tools",
    category: 'artisan',
    defaultAbility: 'DES',
    description:
      'Consertar e montar mecanismos simples de metal: fechaduras, relógios e pequenos dispositivos.',
  },
  {
    id: 'weaver-tools',
    namePt: 'Ferramentas de Tecelão',
    nameEn: "Weaver's Tools",
    category: 'artisan',
    defaultAbility: 'DES',
    description:
      'Fiar, tecer e remendar tecidos, costurando roupas e tapeçarias.',
  },
  {
    id: 'woodcarver-tools',
    namePt: 'Ferramentas de Entalhador',
    nameEn: "Woodcarver's Tools",
    category: 'artisan',
    defaultAbility: 'DES',
    description:
      'Entalhar e esculpir madeira em flechas, ferramentas e objetos decorados.',
  },

  // --- Kits (4) --------------------------------------------------------------
  {
    id: 'disguise-kit',
    namePt: 'Kit de Disfarce',
    nameEn: 'Disguise Kit',
    category: 'kit',
    defaultAbility: 'CAR',
    description:
      'Aplicar disfarces com maquiagem, adereços e tinturas para mudar a aparência.',
  },
  {
    id: 'forgery-kit',
    namePt: 'Kit de Falsificação',
    nameEn: 'Forgery Kit',
    category: 'kit',
    defaultAbility: 'DES',
    description:
      'Falsificar documentos, selos e assinaturas com papéis e tintas que imitam o original.',
  },
  {
    id: 'herbalism-kit',
    namePt: 'Kit de Herbalismo',
    nameEn: 'Herbalism Kit',
    category: 'kit',
    defaultAbility: 'INT',
    description:
      'Coletar plantas, preparar antídotos e poções de cura e identificar ervas e venenos naturais.',
  },
  {
    id: 'poisoner-kit',
    namePt: 'Kit de Envenenador',
    nameEn: "Poisoner's Kit",
    category: 'kit',
    defaultAbility: 'INT',
    description:
      'Extrair, misturar e aplicar venenos, além de reconhecer e neutralizar substâncias tóxicas.',
  },

  // --- Jogo de Tabuleiro ou Cartas (1) --------------------------------------
  {
    id: 'gaming-set',
    namePt: 'Jogo de Tabuleiro ou Cartas',
    nameEn: 'Gaming Set',
    category: 'gamingSet',
    defaultAbility: 'CAR',
    description:
      'Jogar e apostar em jogos de tabuleiro ou de cartas, percebendo truques e trapaças.',
  },

  // --- Instrumento Musical (9) ----------------------------------------------
  {
    id: 'lute',
    namePt: 'Alaúde',
    nameEn: 'Lute',
    category: 'musicalInstrument',
    defaultAbility: 'CAR',
    description:
      'Instrumento de cordas dedilhadas, comum em serenatas e apresentações de taverna.',
  },
  {
    id: 'bagpipes',
    namePt: 'Gaita de Fole',
    nameEn: 'Bagpipes',
    category: 'musicalInstrument',
    defaultAbility: 'CAR',
    description:
      'Instrumento de sopro com foles e palhetas, de som contínuo e marcante.',
  },
  {
    id: 'shawm',
    namePt: 'Charamela',
    nameEn: 'Shawm',
    category: 'musicalInstrument',
    defaultAbility: 'CAR',
    description:
      'Instrumento de sopro de palheta dupla, agudo e penetrante, usado em festas e marchas.',
  },
  {
    id: 'horn',
    namePt: 'Corneta',
    nameEn: 'Horn',
    category: 'musicalInstrument',
    defaultAbility: 'CAR',
    description:
      'Instrumento de sopro de metal, usado para sinais e chamados à distância.',
  },
  {
    id: 'flute',
    namePt: 'Flauta',
    nameEn: 'Flute',
    category: 'musicalInstrument',
    defaultAbility: 'CAR',
    description:
      'Instrumento de sopro pequeno e versátil, de som suave e agudo.',
  },
  {
    id: 'lyre',
    namePt: 'Lira',
    nameEn: 'Lyre',
    category: 'musicalInstrument',
    defaultAbility: 'CAR',
    description:
      'Instrumento de cordas em forma de U, associado à poesia e à música cerimonial.',
  },
  {
    id: 'drum',
    namePt: 'Tambor',
    nameEn: 'Drum',
    category: 'musicalInstrument',
    defaultAbility: 'CAR',
    description:
      'Instrumento de percussão que marca o ritmo em marchas, rituais e combates.',
  },
  {
    id: 'dulcimer',
    namePt: 'Saltério',
    nameEn: 'Dulcimer',
    category: 'musicalInstrument',
    defaultAbility: 'CAR',
    description:
      'Instrumento de cordas percutidas com martelos, de som metálico e ressonante.',
  },
  {
    id: 'pan-flute',
    namePt: 'Zampoña',
    nameEn: 'Pan Flute',
    category: 'musicalInstrument',
    defaultAbility: 'CAR',
    description:
      'Conjunto de tubos de alturas diferentes unidos em fila, tocado soprando pelas extremidades.',
  },

  // --- Navegação (1) ---------------------------------------------------------
  {
    id: 'navigator-tools',
    namePt: 'Ferramentas de Navegador',
    nameEn: "Navigator's Tools",
    category: 'navigator',
    defaultAbility: 'SAB',
    description:
      'Traçar rotas e usar bússola, astrolábio e cartas náuticas para navegar com segurança.',
  },

  // --- Ladrão (1) ------------------------------------------------------------
  {
    id: 'thieves-tools',
    namePt: 'Ferramentas de Ladrão',
    nameEn: "Thieves' Tools",
    category: 'thieves',
    defaultAbility: 'DES',
    description:
      'Abrir fechaduras e desarmar armadilhas com gazuas, limitas e chaves.',
  },

  // --- Veículos (2) ----------------------------------------------------------
  {
    id: 'land-vehicle',
    namePt: 'Veículo (Terrestre)',
    nameEn: 'Land Vehicle',
    category: 'vehicle',
    defaultAbility: 'DES',
    description:
      'Conduzir e controlar veículos terrestres de tração, como carroças e carruagens.',
  },
  {
    id: 'water-vehicle',
    namePt: 'Veículo (Aquático)',
    nameEn: 'Water Vehicle',
    category: 'vehicle',
    defaultAbility: 'DES',
    description:
      'Pilotar embarcações a remo ou a vela e lidar com cordas, velas e timão.',
  },
];
