/**
 * Busca do mestre nas abas do painel.
 *
 * A comparação ignora caixa e acentos de propósito: o mestre digita "regiao" e
 * encontra "Região", ou "npc" e encontra "NPC". É uma busca simples, sobre os
 * dados já carregados no cliente — nenhuma aba precisa de rota nova para
 * filtrar a própria lista.
 */

/** Normaliza um texto para comparação (sem acentos, minúsculo, sem espaços nas pontas). */
export function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** `true` quando a consulta está vazia ou aparece em algum dos campos informados. */
export function matchesSearch(
  query: string,
  ...fields: (string | number | null | undefined)[]
): boolean {
  const needle = normalizeSearch(query);
  if (!needle) return true;

  return fields.some(
    (field) =>
      field !== null && field !== undefined && normalizeSearch(String(field)).includes(needle),
  );
}
