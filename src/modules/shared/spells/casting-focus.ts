import { CLASS_DEFINITIONS } from '../classes/index.js';
import {
  creatureSpellcastingProfileOf,
} from '../creature-spellcasting.js';
import type { SpellcastingFocusKind } from './components.js';

/**
 * FASE 6.6G — FOCOS DE CONJURAÇÃO por FONTE.
 *
 * A permissão de foco pertence à FEATURE de conjuração da fonte (PHB 2014):
 * Bardo usa instrumento musical, Clérigo/Paladino usam símbolo sagrado, Druida
 * usa foco druídico, Mago/Feiticeiro/Bruxo usam foco arcano. Patrulheiro do PHB
 * 2014 NÃO recebe foco pela feature de conjuração — e Cavaleiro Arcano/
 * Trapaceiro Arcano também não, mesmo usando a lista do Mago (§56–§60).
 *
 * Por isso a resposta mora no metadado da CLASSE/SUBCLASSE (fonte) e nunca em
 * `if spellId === ...` ou "usa a lista do Mago, logo pode usar foco arcano".
 * Criatura declara os tipos que o statblock permite (`spellcastingProfile`).
 */
export function focusKindsForClass(
  classKey: string,
  subclassId?: string | null,
): SpellcastingFocusKind[] {
  const definition = CLASS_DEFINITIONS.find((item) => item.key === classKey);
  if (!definition) return [];
  if (subclassId) {
    const subclass = definition.subclasses.find((item) => item.id === subclassId);
    if (subclass?.spellcasting) return subclass.spellcasting.focusKinds ?? [];
  }
  return definition.spellcasting.focusKinds ?? [];
}

/** Tipos de foco aceitos por uma fonte CONCRETA (vazia = nenhum). */
export function focusKindsForSource(
  source: { kind: string; id: string },
  creatureProfile?: unknown,
): SpellcastingFocusKind[] {
  if (source.kind === 'class') return focusKindsForClass(source.id);
  if (source.kind === 'subclass') {
    for (const definition of CLASS_DEFINITIONS) {
      if (!definition.subclasses.some((item) => item.id === source.id)) continue;
      return focusKindsForClass(definition.key, source.id);
    }
    return [];
  }
  if (source.kind === 'creature') {
    return creatureSpellcastingProfileOf(creatureProfile).focusKinds ?? [];
  }
  // `racial`/`feat`/`item`/`feature`/`manual` não concedem foco nesta fase:
  // nenhuma permissão é inferida de outro lugar.
  return [];
}
