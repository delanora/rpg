/**
 * Idiomas do Livro do Jogador (2014).
 *
 * Lista de referência usada para as escolhas de idioma das raças (Humano e
 * Meio-Elfo concedem 1 idioma à escolha) e para validar o que o jogador/mestre
 * grava em `characters.languages`.
 *
 * O sistema guarda o idioma pelo RÓTULO em português (o mesmo texto que as
 * raças já usam: 'Comum', 'Élfico', 'Anão'...), sem separar os idiomas
 * "comuns" dos "exóticos" — a distinção é só narrativa.
 */
export const LANGUAGE_NAMES: readonly string[] = [
  // Idiomas comuns.
  'Comum',
  'Anão',
  'Élfico',
  'Gigante',
  'Gnômico',
  'Goblin',
  'Pequenino',
  'Orc',
  // Idiomas exóticos.
  'Abissal',
  'Celestial',
  'Dracônico',
  'Infernal',
  'Primordial',
  'Silvestre',
  'Subcomum',
];

/** O texto é um idioma conhecido do catálogo? */
export function isLanguageName(value: string): boolean {
  return LANGUAGE_NAMES.includes(value);
}

/** Normaliza uma lista de idiomas: remove vazios/duplicados e ignora desconhecidos. */
export function normalizeLanguages(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const name = raw.trim();
    if (!name || seen.has(name) || !isLanguageName(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}
