import { useState } from 'react';
import { ReadOnlyProvider } from '../readonly';
import type { Character, CharacterPatch } from '../types';
import { Icon, type IconName } from './Icon';
import { AbilitiesSection } from './sections/AbilitiesSection';
import { AttacksSection } from './sections/AttacksSection';
import { FeaturesSection } from './sections/FeaturesSection';
import { IdentitySection } from './sections/IdentitySection';
import { InventorySection } from './sections/InventorySection';
import { NotesSection } from './sections/NotesSection';
import { SkillsSavesSection } from './sections/SkillsSavesSection';
import { SpellsSection } from './sections/SpellsSection';
import { VitalsSection } from './sections/VitalsSection';

/** Abas da ficha, como as divisões de um grimório. */
const TABS = [
  { key: 'identity', label: 'Identidade', icon: 'scroll' },
  { key: 'abilities', label: 'Atributos', icon: 'shield' },
  { key: 'vitals', label: 'Vida & Defesa', icon: 'heart' },
  { key: 'skills', label: 'Perícias', icon: 'eye' },
  { key: 'inventory', label: 'Inventário', icon: 'flask' },
  { key: 'spells', label: 'Magias', icon: 'star' },
  { key: 'attacks', label: 'Ataques', icon: 'sword' },
  { key: 'features', label: 'Características', icon: 'book' },
  { key: 'notes', label: 'Anotações', icon: 'quill' },
] as const satisfies readonly { key: string; label: string; icon: IconName }[];

type TabKey = (typeof TABS)[number]['key'];

interface SheetViewProps {
  character: Character;
  update: (patch: CharacterPatch) => void;
  /** Em `true`, nenhum campo é editável (visão do mestre). */
  readOnly?: boolean;
}

/** Renderiza a seção correspondente à aba ativa. */
function renderSection(key: TabKey, character: Character, update: (patch: CharacterPatch) => void) {
  switch (key) {
    case 'identity':
      return <IdentitySection character={character} update={update} />;
    case 'abilities':
      return <AbilitiesSection character={character} update={update} />;
    case 'vitals':
      return <VitalsSection character={character} update={update} />;
    case 'skills':
      return <SkillsSavesSection character={character} update={update} />;
    case 'inventory':
      return <InventorySection character={character} update={update} />;
    case 'spells':
      return <SpellsSection character={character} update={update} />;
    case 'attacks':
      return <AttacksSection character={character} update={update} />;
    case 'features':
      return <FeaturesSection character={character} update={update} />;
    case 'notes':
      return <NotesSection character={character} update={update} />;
  }
}

/** Ficha completa, em abas. Reutilizada pelo jogador (editável) e pelo mestre (leitura). */
export function SheetView({ character, update, readOnly = false }: SheetViewProps) {
  const [tab, setTab] = useState<TabKey>('identity');
  const active = TABS.find((item) => item.key === tab) ?? TABS[0];

  return (
    <ReadOnlyProvider value={readOnly}>
      <div className="sheet">
        <div className="sheet-tabs" role="tablist" aria-label="Seções da ficha">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={item.key === tab}
              className={item.key === tab ? 'sheet-tab active' : 'sheet-tab'}
              onClick={() => setTab(item.key)}
            >
              <Icon name={item.icon} size={16} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        {/* A `key` reinicia a animação de "virar a página" a cada troca de aba. */}
        <div className="sheet-panel" key={tab} role="tabpanel" aria-label={active.label}>
          {renderSection(tab, character, update)}
        </div>
      </div>
    </ReadOnlyProvider>
  );
}
