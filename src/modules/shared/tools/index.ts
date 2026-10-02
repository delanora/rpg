import { TOOLS } from './catalog.js';
import type { Tool, ToolCategory } from './types.js';

export * from './types.js';
export { TOOLS } from './catalog.js';

/**
 * Catálogo de ferramentas do PHB 2014 — ver catalog.ts para a lista fechada.
 *
 * As funções abaixo são a única porta de entrada: nada aqui concede proficiência
 * nem rola dado; só resolvem id, categoria e a lista completa.
 */
const TOOL_BY_ID: ReadonlyMap<string, Tool> = new Map(
  TOOLS.map((tool) => [tool.id, tool]),
);

/** Busca uma ferramenta pelo id estável (ex.: "thieves-tools"). */
export function getTool(id: string): Tool | undefined {
  return TOOL_BY_ID.get(id.trim());
}

/** Ferramentas de UMA categoria, na ordem do catálogo. */
export function toolsByCategory(category: ToolCategory): Tool[] {
  return TOOLS.filter((tool) => tool.category === category);
}

/** Todas as ferramentas, na ordem do catálogo (cópia — não muta o registro). */
export function allTools(): Tool[] {
  return [...TOOLS];
}
