/**
 * NOME DE EXIBIÇÃO NO COMBATE.
 *
 * A dock é apertada: em modo de combate o personagem aparece só pelo PRIMEIRO
 * nome ("Razzil da Silva" → "Razzil"). É formatação de tela — nenhum dado é
 * alterado, nenhum nome é enviado de volta ao servidor e a ficha inteira
 * continua mostrando o nome completo.
 */
export function combatDisplayName(name: string): string {
  const clean = name.trim();
  if (!clean) return clean;
  const [first] = clean.split(/\s+/);
  return first || clean;
}
