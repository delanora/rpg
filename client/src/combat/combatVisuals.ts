import type { DamageTypeSlug } from '../damage';
import type { IconName } from '../components/Icon';
import type { CombatantKind } from '../types';
import type { EconomyAction } from './combatApi';

/**
 * FONTE ÚNICA de apresentação do combate (só texto e associação visual).
 *
 * Aqui NÃO há regra: nem cálculo, nem autoridade. As descrições seguem o
 * PHB 2014 e existem apenas para os tooltips curtos usados durante a sessão.
 * A cor de uma Condition com associação clara a um tipo de dano reaproveita a
 * família já existente em `styles.css` (`--damage-*`); sem associação, ela usa
 * uma cor própria (`--condition-*`). A decisão de cor NÃO depende da mecânica.
 */

export interface ConditionVisual {
  /** Explicação curta para o tooltip (hover/focus sobre a etiqueta). */
  description: string;
  /**
   * Família de Damage Type compartilhada quando a relação é clara (ex.:
   * Envenenado ↔ Veneno). Quando ausente, a cor vem da própria condição.
   */
  damageFamily?: DamageTypeSlug;
}

/**
 * 14 condições do PHB 2014. Somente `poisoned` tem associação visual clara a um
 * tipo de dano (Veneno); as demais recebem cor semântica própria — não forçamos
 * relações artificiais (ex.: Caído NÃO vira Concussão só porque quedas machucam).
 */
export const CONDITION_VISUALS: Record<string, ConditionVisual> = {
  blinded: {
    description:
      'Não enxerga: falha automaticamente em testes que dependam de visão. Ataques contra ela têm vantagem; os dela, desvantagem.',
  },
  charmed: {
    description:
      'Não pode atacar quem a enfeitiçou nem usar efeitos prejudiciais contra ele; ele tem vantagem em testes sociais com ela.',
  },
  deafened: {
    description: 'Não ouve: falha automaticamente em testes que dependam de audição.',
  },
  frightened: {
    description:
      'Tem desvantagem em testes e jogadas de ataque enquanto enxergar a fonte do medo, e não pode se aproximar dela por vontade própria.',
  },
  grappled: {
    description:
      'Deslocamento 0. Termina se quem agarra ficar incapacitado ou se a criatura for afastada do alcance do agarrão.',
  },
  incapacitated: {
    description: 'Não pode executar ações nem reações.',
  },
  invisible: {
    description:
      'Impossível de enxergar sem meios especiais. Ataques contra ela têm desvantagem; os dela, vantagem.',
  },
  paralyzed: {
    description:
      'Incapacitada, não se move nem fala. Falha em salvaguardas de Força e Destreza. Ataques contra ela têm vantagem e acertos a até 1,5 m são críticos.',
  },
  petrified: {
    description:
      'Transformada em pedra: incapacitada, sem consciência do entorno, resistente a todo dano e imune a veneno e doença.',
  },
  poisoned: {
    description: 'Tem desvantagem em jogadas de ataque e testes de habilidade.',
    // Associação CLARA: a condição compartilha a família visual do dano Veneno.
    damageFamily: 'poison',
  },
  prone: {
    description:
      'Só pode rastejar e tem desvantagem em ataques. Ataques corpo a corpo contra ela têm vantagem; à distância, desvantagem.',
  },
  restrained: {
    description:
      'Deslocamento 0. Ataques contra ela têm vantagem, os dela têm desvantagem e tem desvantagem em salvaguardas de Destreza.',
  },
  stunned: {
    description:
      'Incapacitada, não se move e só fala com dificuldade. Falha em salvaguardas de Força e Destreza. Ataques contra ela têm vantagem.',
  },
  unconscious: {
    description:
      'Incapacitada, cai e fica caída. Falha em salvaguardas de Força e Destreza. Ataques contra ela têm vantagem e acertos a até 1,5 m são críticos.',
  },
};

/** Texto de tooltip de uma condição; nunca deixa a etiqueta sem explicação. */
export function conditionDescription(condition: string): string {
  return CONDITION_VISUALS[condition]?.description ?? 'Condição ativa.';
}

/** Família de Damage Type de uma condição, quando há associação clara. */
export function conditionDamageFamily(condition: string): DamageTypeSlug | null {
  return CONDITION_VISUALS[condition]?.damageFamily ?? null;
}

/** Textos curtos dos controles de recursos (usados nos ícones "i"). */
export const RESOURCE_INFO = {
  action:
    'Usada para atacar ou executar ações como Disparada, Desengajar, Esquivar, Esconder-se e Preparar.',
  bonus:
    'Só pode ser usada quando uma característica, magia ou regra específica permitir.',
  reaction:
    'Usada em resposta a um gatilho específico. Normalmente retorna no início do seu próximo turno.',
  movement:
    'Escolha quantos metros deseja consumir nesta movimentação. O valor será descontado do deslocamento disponível no turno.',
  rollMode:
    'Normal rola 1d20. Vantagem/Desvantagem rolam 2d20 e mantêm o maior/menor resultado.',
} as const;

/**
 * Ações gerais do PHB 2014 JÁ suportadas pela economia de turno existente.
 * A ordem é a hierarquia do menu da barra: as mais usadas primeiro. Nada é
 * reimplementado no cliente — cada item chama `executeEconomyAction`.
 */
export interface EconomyActionVisual {
  id: EconomyAction;
  label: string;
  description: string;
}

export const ECONOMY_ACTION_VISUALS: EconomyActionVisual[] = [
  { id: 'dash', label: 'Disparada', description: 'Ganha deslocamento adicional igual ao seu deslocamento neste turno.' },
  { id: 'disengage', label: 'Desengajar', description: 'Seu movimento não provoca ataques de oportunidade neste turno.' },
  { id: 'dodge', label: 'Esquivar', description: 'Foca em defesa: ataques contra você têm desvantagem até o início do seu próximo turno.' },
  { id: 'hide', label: 'Esconder-se', description: 'Tenta ficar oculto quando as circunstâncias permitirem.' },
  { id: 'ready', label: 'Preparar', description: 'Define um gatilho e uma resposta para usar depois com a sua Reação.' },
  { id: 'help', label: 'Ajudar', description: 'Concede vantagem a um aliado contra um alvo próximo de você.' },
  { id: 'search', label: 'Procurar', description: 'Dedica-se a encontrar algo escondido.' },
  { id: 'use-object', label: 'Usar um Objeto', description: 'Interage com um objeto que exija a sua atenção.' },
  { id: 'improvised', label: 'Outra ação', description: 'Registra uma ação improvisada combinada com o Mestre.' },
];

/** Descrição de uma ação de economia pelo id; fallback honesto. */
export function economyActionDescription(id: EconomyAction): string {
  return ECONOMY_ACTION_VISUALS.find((item) => item.id === id)?.description ?? '';
}

/**
 * Rótulo e ícone do TIPO de combatente — o NPC NÃO é "personagem" nem
 * "criatura": é um tipo próprio do cadastro narrativo do Mestre.
 * Só apresentação; `kind` vem do servidor.
 */
export function combatantKindLabel(kind: CombatantKind): string {
  if (kind === 'CREATURE') return 'criatura';
  if (kind === 'NPC') return 'NPC';
  return 'personagem';
}

export function combatantKindIcon(kind: CombatantKind): IconName {
  if (kind === 'CREATURE') return 'flame';
  if (kind === 'NPC') return 'scroll';
  return 'users';
}
