import { ReadOnlyProvider } from '../readonly';
import type { Character, CharacterPatch } from '../types';
import { AbilitiesSection } from './sections/AbilitiesSection';
import { AttacksSection } from './sections/AttacksSection';
import { FeaturesSection } from './sections/FeaturesSection';
import { IdentitySection } from './sections/IdentitySection';
import { InventorySection } from './sections/InventorySection';
import { NotesSection } from './sections/NotesSection';
import { SkillsSavesSection } from './sections/SkillsSavesSection';
import { SpellsSection } from './sections/SpellsSection';
import { VitalsSection } from './sections/VitalsSection';

interface SheetViewProps {
  character: Character;
  update: (patch: CharacterPatch) => void;
  /** Em `true`, nenhum campo é editável (visão do mestre). */
  readOnly?: boolean;
}

/** Ficha completa. Reutilizada pelo jogador (editável) e pelo mestre (leitura). */
export function SheetView({ character, update, readOnly = false }: SheetViewProps) {
  return (
    <ReadOnlyProvider value={readOnly}>
      <div className="sheet">
        <IdentitySection character={character} update={update} />
        <AbilitiesSection character={character} update={update} />
        <VitalsSection character={character} update={update} />
        <SkillsSavesSection character={character} update={update} />
        <InventorySection character={character} update={update} />
        <SpellsSection character={character} update={update} />
        <AttacksSection character={character} update={update} />
        <FeaturesSection character={character} update={update} />
        <NotesSection character={character} update={update} />
      </div>
    </ReadOnlyProvider>
  );
}
