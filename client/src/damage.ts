/**
 * Tipos de dano do D&D 5e 2014 — FONTE ÚNICA do mapeamento rótulo (vindo do
 * backend, em português) → slug usado só para a apresentação (cor/estilo).
 *
 * O backend já envia o tipo já resolvido em `DamageComponentPayload.type`
 * (ou `''` quando o dano não tem tipo). Aqui NÃO há classificação nem regra:
 * só traduzimos o rótulo para um slug estável, para o CSS escolher o accent.
 * Qualquer tipo fora do mapa cai em `default` (acento neutro) e nunca quebra.
 */

export type DamageTypeSlug =
  | 'acid'
  | 'bludgeoning'
  | 'cold'
  | 'fire'
  | 'force'
  | 'lightning'
  | 'necrotic'
  | 'piercing'
  | 'poison'
  | 'psychic'
  | 'radiant'
  | 'slashing'
  | 'thunder';

/** Rótulo canônico (servidor) → slug. Espelha DAMAGE_TYPES de shared/attacks.ts. */
const DAMAGE_TYPE_SLUGS: Record<string, DamageTypeSlug> = {
  'Ácido': 'acid',
  'Concussão': 'bludgeoning',
  'Frio': 'cold',
  'Fogo': 'fire',
  'Força': 'force',
  'Elétrico': 'lightning',
  'Necrótico': 'necrotic',
  'Perfurante': 'piercing',
  'Veneno': 'poison',
  'Psíquico': 'psychic',
  'Radiante': 'radiant',
  'Cortante': 'slashing',
  'Trovão': 'thunder',
};

/** Slug de apresentação do tipo; `default` para tipo ausente ou desconhecido. */
export function damageTypeSlug(type: string | null | undefined): DamageTypeSlug | 'default' {
  if (!type) return 'default';
  return DAMAGE_TYPE_SLUGS[type] ?? 'default';
}
