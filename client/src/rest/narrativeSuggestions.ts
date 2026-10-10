import { coinCount } from '../coins';
import { SKILLS, formatModifier } from '../dnd';
import type { CoinPurse } from '../types';

/**
 * Assistência narrativa do Mestre (5.2.8A biblioteca + 5.2.8B contexto).
 *
 * É uma BIBLIOTECA FIXA e determinística de ideias, priorizada por um score
 * simples a partir de dados que a mesa realmente tem. Nada aqui — em nenhum
 * caminho — gera texto livre, chama modelo/API externa, rola dado, define DC,
 * concede recurso ou item, cria NPC/encontro, altera inventário ou aplica
 * consequência: a sugestão é GANCHO de cena, nunca RESOLUÇÃO.
 *
 * ⚠️ VISIBILIDADE: módulo consumido apenas pelo painel do MESTRE. A análise roda
 * no cliente dele, a partir das fichas que o Mestre já carrega (`GET
 * /api/characters` é rota de Mestre); o jogador não recebe a biblioteca, a
 * análise, a indicação de personagem nem os bastidores — ele recebe só a cena
 * que o Mestre narrar.
 *
 * Reutilizável no futuro (exploração, falhas de perícia, viagens, encontros
 * sociais): a biblioteca é só dado + ranking puro sobre um contexto genérico.
 */

/** Categoria editorial da ideia (agrupa a leitura do Mestre, não muda regra). */
export type NarrativeSuggestionCategory =
  | 'RECURSOS'
  | 'SOCIAL'
  | 'NEGOCIACAO'
  | 'EXPLORACAO'
  | 'NARRATIVA';

export const NARRATIVE_CATEGORY_LABELS: Record<NarrativeSuggestionCategory, string> = {
  RECURSOS: 'Recursos naturais',
  SOCIAL: 'Relações e hospitalidade',
  NEGOCIACAO: 'Negociação',
  EXPLORACAO: 'Exploração',
  NARRATIVA: 'Consequência narrativa',
};

/**
 * Sinais de contexto REAIS que o ranking sabe usar. Cada um vem de um dado que
 * existe hoje: perícias das fichas dos participantes, pontos que faltam no
 * requisito de acampamento e a carteira de moedas. Não há tag de bioma/região
 * porque o catálogo atual (Region/Locality) só tem nome e descrição livres —
 * inferir "floresta" pelo nome seria inventar cenário.
 */
export type NarrativeContextTag =
  | 'HUNT_SKILLS'
  | 'SOCIAL_SKILLS'
  | 'INVESTIGATION_SKILLS'
  | 'FEW_MISSING'
  | 'MANY_MISSING'
  | 'COINS';

export interface NarrativeSuggestion {
  id: string;
  title: string;
  /** Uma linha: é o que aparece no card recolhido. */
  summary: string;
  /** Texto de apoio para quando o Mestre abre a ideia. */
  description: string;
  /** Caminhos POSSÍVEIS, em forma de convite (nunca passos obrigatórios). */
  possibilities: readonly string[];
  category: NarrativeSuggestionCategory;
  /**
   * Perícias que PODEM estar envolvidas. Nunca viram DC nem teste automático —
   * a UI escreve "Pode envolver:".
   */
  hints: readonly string[];
  /** O que uma perícia relevante ajudaria a FAZER (frase do painel). */
  skillRole: string;
  contextTags: readonly NarrativeContextTag[];
}

/**
 * As 8 ideias iniciais. Título/resumo curto + detalhamento, exatamente no tom
 * pedido: descrever a POSSIBILIDADE, sem inventar fato do cenário ("há javalis a
 * 300 m" é proibido nesta fase) e sem prometer solução.
 */
export const NARRATIVE_SUGGESTIONS: readonly NarrativeSuggestion[] = [
  {
    id: 'hunt',
    title: 'Caça e coleta',
    summary: 'O grupo pode procurar alimento nos arredores.',
    description:
      'Uma busca ativa por comida e água transforma a falta de recursos em uma cena de campo — o terreno decide o que existe ali, não a sugestão.',
    possibilities: [
      'rastrear animais',
      'pescar',
      'procurar frutas ou raízes',
      'recolher água potável',
      'seguir rastros próximos ao acampamento',
    ],
    category: 'RECURSOS',
    hints: ['Sobrevivência', 'Natureza', 'Adestramento'],
    skillRole: 'liderar uma busca por alimento',
    // Escassez grande costuma pedir caça/coleta de verdade (e não uma compra).
    contextTags: ['HUNT_SKILLS', 'MANY_MISSING'],
  },
  {
    id: 'npc-help',
    title: 'Ajuda de NPC',
    summary:
      'O grupo pode procurar ajuda de moradores, viajantes, comerciantes, templos ou outras pessoas da região.',
    description:
      'Alguém da região pode ter o que falta — em troca de conversa, informação, serviço ou simples hospitalidade. Quem existe ali é decisão do Mestre.',
    possibilities: [
      'hospitalidade',
      'troca',
      'favor',
      'informação',
      'dívida',
      'relação futura',
    ],
    category: 'SOCIAL',
    hints: ['Persuasão', 'Intuição', 'História'],
    skillRole: 'conduzir a conversa',
    // "Ajuda externa" serve tanto para a falta pequena quanto para a grande.
    contextTags: ['SOCIAL_SKILLS', 'FEW_MISSING', 'MANY_MISSING'],
  },
  {
    id: 'bargain',
    title: 'Barganha',
    summary: 'Alguém pode fornecer o que falta em troca de algo.',
    description:
      'O preço narrativo é do Mestre: favor, promessa, informação, serviço, proteção, item ou dívida futura. Este painel não define valor nenhum.',
    possibilities: [
      'favor',
      'promessa',
      'informação',
      'serviço',
      'proteção',
      'item',
      'dívida futura',
    ],
    category: 'NEGOCIACAO',
    hints: ['Persuasão', 'Enganação', 'Intuição'],
    skillRole: 'negociar o que será oferecido',
    contextTags: ['SOCIAL_SKILLS'],
  },
  {
    id: 'purchase',
    title: 'Compra',
    summary: 'O grupo pode tentar adquirir os recursos.',
    description:
      'Uma mesa de compra resolve rápido o que falta — desde que exista onde comprar e que o Mestre queira abrir a cena. Nada é descontado automaticamente.',
    possibilities: [
      'comerciante',
      'taverna',
      'mercado',
      'caravana',
      'assentamento',
    ],
    category: 'NEGOCIACAO',
    hints: ['Persuasão', 'Intuição'],
    skillRole: 'negociar preço ou condições',
    contextTags: ['COINS', 'FEW_MISSING'],
  },
  {
    id: 'environment',
    title: 'Recursos do ambiente',
    summary: 'A própria região pode oferecer uma solução.',
    description:
      'Olhar o cenário como recurso: o que já está no caminho do grupo pode bastar sem sair da rota. O Mestre decide o que a região oferece.',
    possibilities: [
      'rio',
      'lago',
      'caça',
      'vegetação',
      'cavernas',
      'abrigo',
      'plantações',
      'depósitos abandonados',
    ],
    category: 'RECURSOS',
    hints: ['Sobrevivência', 'Percepção', 'Natureza'],
    skillRole: 'ler o terreno e reconhecer o que dá para aproveitar',
    // Coleta pequena: costuma bastar para fechar uma falta de poucos pontos.
    contextTags: ['HUNT_SKILLS', 'INVESTIGATION_SKILLS', 'FEW_MISSING'],
  },
  {
    id: 'narrative-cost',
    title: 'Consequência narrativa',
    summary: 'O Mestre pode permitir o descanso, mas introduzir um custo narrativo.',
    description:
      'O descanso acontece e a história cobra depois: dívida, favor, atraso, compromisso, complicação social. Nada disso é aplicado por este painel.',
    possibilities: [
      'dívida',
      'favor',
      'atraso',
      'compromisso',
      'recurso futuro',
      'complicação',
      'consequência social',
    ],
    category: 'NARRATIVA',
    hints: [],
    skillRole: 'conviver com o custo que a história cobrar',
    contextTags: ['MANY_MISSING'],
  },
  {
    id: 'shelter',
    title: 'Abrigo e hospitalidade',
    summary:
      'O grupo pode conseguir abrigo ou alimentação por meio de relações sociais.',
    description:
      'Quem já conhece o grupo pode oferecer teto e comida — e cobrar ou não por isso depois. Depende de quem existe na região e do Mestre.',
    possibilities: [
      'pousada',
      'templo',
      'fazendeiro',
      'aliado',
      'facção',
      'vila',
    ],
    category: 'SOCIAL',
    hints: ['Persuasão', 'Religião', 'História'],
    skillRole: 'pedir abrigo em nome do grupo',
    contextTags: ['SOCIAL_SKILLS'],
  },
  {
    id: 'exploration',
    title: 'Exploração',
    summary:
      'O problema de recursos pode se transformar em uma pequena cena de exploração.',
    description:
      'Em vez de resolver a falta de imediato, o grupo investiga o entorno: uma trilha, ruínas ou um depósito abandonado podem render a cena — e o que há lá é do Mestre.',
    possibilities: [
      'procurar depósitos',
      'explorar uma trilha',
      'investigar ruínas',
      'buscar água',
      'vasculhar uma área próxima',
    ],
    category: 'EXPLORACAO',
    hints: ['Investigação', 'Percepção', 'Sobrevivência'],
    skillRole: 'guiar a busca pelo entorno',
    contextTags: ['INVESTIGATION_SKILLS', 'MANY_MISSING'],
  },
];

// -----------------------------------------------------------------------------
// 5.2.8B — contexto determinístico
// -----------------------------------------------------------------------------

/** Um participante EFETIVO do descanso (só ACCEPTED), reduzido ao que importa. */
export interface NarrativeParticipant {
  name: string;
  /** Total de cada perícia já derivado pelo servidor (`derived.skills[key].total`). */
  skillTotals: Readonly<Record<string, number>>;
  /** O personagem tem moedas na carteira? (fonte: `coins` da ficha). */
  hasCoins: boolean;
  /** Quantas pilhas de recurso de acampamento ele ainda tem disponíveis. */
  campSupplyItems: number;
}

export interface NarrativeContext {
  /** Pontos que faltam para o requisito (0 quando satisfeito/desligado). */
  remainingPoints: number;
  /** Requisito total de pontos (0 quando a mecânica está desligada). */
  requiredPoints: number;
  /** Apenas os participantes ACCEPTED do descanso. */
  participants: readonly NarrativeParticipant[];
}

/** Perícia "boa o bastante" para virar destaque/dica (determinístico). */
export const RELEVANT_SKILL_TOTAL = 3;

/** Abaixo disso a falta é "pouca"; acima da metade, é "grande". */
const FEW_MISSING_RATIO = 0.25;
const MANY_MISSING_RATIO = 0.5;

/**
 * Peso de cada sinal ativo. Todos pesam igual de propósito: um ÚNICO sinal real
 * já basta para a ideia aparecer como "Relevante para esta situação", e o que
 * ordena é a QUANTIDADE de sinais que convergem (mais contexto = mais acima).
 * Determinístico, sem aprendizado de máquina.
 */
const TAG_WEIGHTS: Record<NarrativeContextTag, number> = {
  HUNT_SKILLS: 3,
  SOCIAL_SKILLS: 3,
  INVESTIGATION_SKILLS: 3,
  FEW_MISSING: 3,
  MANY_MISSING: 3,
  COINS: 3,
};

/** Score mínimo para a ideia aparecer como destacada no painel. */
const HIGHLIGHT_THRESHOLD = 3;

/**
 * Ficha reduzida ao que a análise CONSOME — descrita estruturalmente para não
 * acoplar a biblioteca ao DTO inteiro: o `Character` do painel do Mestre (e o
 * mesmo shape vindo de `GET /api/characters`, rota de Mestre) satisfaz isto.
 *
 * Não há aqui região, bioma, NPC nem preço: esse dado NÃO existe de forma
 * estruturada hoje e a análise simplesmente não o usa.
 */
export interface NarrativeCharacter {
  id: string;
  name: string;
  /** Totais já derivados pelo servidor (`derived.skills[key].total`). */
  derived: { skills: Record<string, { total: number }> };
  coins: CoinPurse;
  inventory: readonly {
    quantity: number;
    campSupply?: { enabled?: boolean } | null;
  }[];
}

/**
 * Reduz uma ficha ao contexto que a análise usa — só o que é CONFIÁVEL hoje:
 * nome, totais de perícia já derivados pelo servidor, existência de moedas e
 * quantas pilhas de recurso de acampamento ainda estão disponíveis.
 */
export function participantContextOf(character: NarrativeCharacter): NarrativeParticipant {
  const skillTotals: Record<string, number> = {};
  for (const [key, detail] of Object.entries(character.derived.skills ?? {})) {
    if (typeof detail?.total === 'number') skillTotals[key] = detail.total;
  }
  return {
    name: character.name,
    skillTotals,
    hasCoins: coinCount(character.coins) > 0,
    campSupplyItems: (character.inventory ?? []).filter(
      (item) => item.campSupply?.enabled === true && item.quantity > 0,
    ).length,
  };
}

/**
 * Monta o contexto da ANÁLISE a partir da solicitação viva do Descanso Longo.
 *
 * Regras de escopo, todas determinísticas:
 * - só participantes **ACCEPTED** entram (quem recusou não é solução disponível);
 * - a ficha precisa pertencer a ESTA solicitação (casamento por `characterId`),
 *   então uma ficha de outra mesa/contexto nunca entra na análise;
 * - sem ficha carregada, o participante simplesmente não contribui com perícia —
 *   a biblioteca fixa continua funcionando, sem placeholder inventado.
 */
export function buildNarrativeContext(input: {
  participants: readonly { characterId: string; response: string }[];
  characters: readonly NarrativeCharacter[];
  remainingPoints: number;
  requiredPoints: number;
}): NarrativeContext {
  const { participants, characters, remainingPoints, requiredPoints } = input;
  const byId = new Map(characters.map((character) => [character.id, character]));
  const accepted = participants
    .filter((participant) => participant.response === 'ACCEPTED')
    .map((participant) => byId.get(participant.characterId))
    .filter((character): character is NarrativeCharacter => character !== undefined)
    .map(participantContextOf);

  return { remainingPoints, requiredPoints, participants: accepted };
}

const SKILL_LABELS: Record<string, string> = Object.fromEntries(
  SKILLS.map((skill) => [skill.key, skill.label]),
);

/** Perícias que ativam cada tag (na ordem em que aparecem no painel). */
const TAG_SKILLS: Partial<Record<NarrativeContextTag, readonly string[]>> = {
  HUNT_SKILLS: ['survival', 'nature', 'animalHandling'],
  SOCIAL_SKILLS: ['persuasion', 'insight', 'deception'],
  INVESTIGATION_SKILLS: ['investigation', 'perception'],
};

const TAG_REASONS: Record<NarrativeContextTag, (skillLabel: string) => string> = {
  HUNT_SKILLS: (skill) => `Destacada porque há personagens com boa ${skill}.`,
  SOCIAL_SKILLS: (skill) => `Destacada porque há personagens com boa ${skill}.`,
  INVESTIGATION_SKILLS: (skill) => `Destacada porque há personagens com boa ${skill}.`,
  FEW_MISSING: () => 'Faltam poucos recursos — soluções simples tendem a bastar.',
  MANY_MISSING: () =>
    'A falta é grande — pode render uma cena mais longa (nada aqui garante que ela resolva).',
  COINS: () =>
    'O grupo possui recursos financeiros que podem tornar a compra uma opção.',
};

export interface RankedNarrativeSuggestion {
  suggestion: NarrativeSuggestion;
  /** Score determinístico (só para ordenar/destacar — nunca exibido como regra). */
  score: number;
  /** Aparece como "Relevante para esta situação". */
  highlighted: boolean;
  /** Por que esta ideia foi destacada (explicabilidade para o Mestre). */
  reasons: string[];
  /**
   * Perícias de quem PARTICIPA que podem ajudar — sempre como possibilidade
   * ("pode ser uma boa opção"), nunca escolhendo protagonista nem pedindo teste.
   */
  participantNotes: string[];
}

export interface NarrativeRanking {
  suggestions: RankedNarrativeSuggestion[];
  /** Fatos reais usados (ou disponíveis) nesta análise — nada inventado. */
  contextNotes: string[];
  /** `false` quando não há NENHUM dado confiável: mostra só a biblioteca fixa. */
  hasContext: boolean;
}

/**
 * Ordena a biblioteca pelo contexto ATUAL, de forma determinística: soma de
 * pesos das tags ativas (empate mantém a ordem da biblioteca) e explicação por
 * ideia. Sem contexto confiável, devolve a biblioteca na ordem original, sem
 * destaque e sem motivo — nunca um placeholder inventado.
 */
export function rankNarrativeSuggestions(context: NarrativeContext): NarrativeRanking {
  const { remainingPoints, requiredPoints, participants } = context;

  const activeReasons = new Map<NarrativeContextTag, string>();
  const contextNotes: string[] = [];

  // Perícias dos participantes ACCEPTED (o primeiro que bate vira o motivo).
  const tagSkills: Record<string, string[]> = {};
  for (const participant of participants) {
    for (const [tag, skills] of Object.entries(TAG_SKILLS) as [
      NarrativeContextTag,
      readonly string[],
    ][]) {
      for (const skill of skills ?? []) {
        const total = participant.skillTotals[skill];
        if (typeof total !== 'number' || total < RELEVANT_SKILL_TOTAL) continue;
        (tagSkills[tag] ??= []);
        if (!activeReasons.has(tag)) {
          activeReasons.set(tag, TAG_REASONS[tag](SKILL_LABELS[skill] ?? skill));
        }
        const entry = `${participant.name}|${skill}|${total}`;
        if (!tagSkills[tag].includes(entry)) tagSkills[tag].push(entry);
      }
    }
  }

  // Pontos faltantes: só entra quando a mecânica exige e realmente falta algo.
  if (remainingPoints > 0 && requiredPoints > 0) {
    if (remainingPoints <= requiredPoints * FEW_MISSING_RATIO) {
      activeReasons.set('FEW_MISSING', TAG_REASONS.FEW_MISSING(''));
      contextNotes.push(`Faltam ${remainingPoints} de ${requiredPoints} pontos — falta pouco.`);
    } else if (remainingPoints >= requiredPoints * MANY_MISSING_RATIO) {
      activeReasons.set('MANY_MISSING', TAG_REASONS.MANY_MISSING(''));
      contextNotes.push(
        `Faltam ${remainingPoints} de ${requiredPoints} pontos — a falta é grande.`,
      );
    } else {
      contextNotes.push(`Faltam ${remainingPoints} de ${requiredPoints} pontos.`);
    }
  }

  // Moedas: só a EXISTÊNCIA de saldo (nenhum preço é conhecido aqui).
  const withCoins = participants.filter((participant) => participant.hasCoins);
  if (withCoins.length > 0) {
    activeReasons.set('COINS', TAG_REASONS.COINS(''));
    contextNotes.push(
      `${withCoins.length} participante(s) com moedas na carteira — podem tornar a compra uma opção.`,
    );
  }

  // Itens de acampamento ainda disponíveis: fato, sem virar bônus de regra.
  const campItems = participants.reduce(
    (sum, participant) => sum + participant.campSupplyItems,
    0,
  );
  if (campItems > 0) {
    contextNotes.push(
      `${campItems} pilha(s) de recurso de acampamento ainda disponíveis nas fichas.`,
    );
  }

  const suggestions = NARRATIVE_SUGGESTIONS.map((suggestion, index) => {
    const reasons: string[] = [];
    let score = 0;
    for (const tag of suggestion.contextTags) {
      const reason = activeReasons.get(tag);
      if (!reason) continue;
      score += TAG_WEIGHTS[tag];
      if (!reasons.includes(reason)) reasons.push(reason);
    }

    const participantNotes: string[] = [];
    for (const tag of suggestion.contextTags) {
      for (const entry of tagSkills[tag] ?? []) {
        const [name, skill, total] = entry.split('|');
        participantNotes.push(
          `${name} possui ${SKILL_LABELS[skill] ?? skill} ${formatModifier(Number(total))} — ` +
            `pode ser uma boa opção para ${suggestion.skillRole}.`,
        );
      }
    }

    return {
      suggestion,
      score,
      highlighted: score >= HIGHLIGHT_THRESHOLD,
      reasons,
      participantNotes,
      index,
    };
  })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ index: _index, ...rest }) => rest);

  return {
    suggestions,
    contextNotes,
    hasContext: activeReasons.size > 0 || contextNotes.length > 0,
  };
}
