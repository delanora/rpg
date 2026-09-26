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

/** Seções que ficam nas abas — o resto do HUD nunca sai da tela. */
const TAB_SECTIONS = [
  { key: 'skills', label: 'Perícias', icon: 'eye' },
  { key: 'inventory', label: 'Inventário', icon: 'flask' },
  { key: 'spells', label: 'Magias', icon: 'star' },
  { key: 'attacks', label: 'Ataques', icon: 'sword' },
  { key: 'features', label: 'Características', icon: 'book' },
] as const satisfies readonly { key: string; label: string; icon: IconName }[];

type TabKey = (typeof TAB_SECTIONS)[number]['key'];

interface SheetViewProps {
  character: Character;
  update: (patch: CharacterPatch) => void;
  /** Em `true`, nenhum campo é editável (visão do mestre). */
  readOnly?: boolean;
}

function renderTab(key: TabKey, character: Character, update: (patch: CharacterPatch) => void) {
  switch (key) {
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
  }
}

/**
 * Ficha em forma de HUD: identidade, atributos, vida e anotações ficam sempre
 * à vista, e só as seções mais longas (perícias, inventário, magias, ataques,
 * características) vivem em abas. Reutilizada pelo jogador e pelo mestre.
 */
export function SheetView({ character, update, readOnly = false }: SheetViewProps) {
  const [tab, setTab] = useState<TabKey>('skills');
  const active = TAB_SECTIONS.find((item) => item.key === tab) ?? TAB_SECTIONS[0];

  return (
    <ReadOnlyProvider value={readOnly}>
      <div className="sheet">
        {/*
         * Duas colunas de largura fixa e alinhada em toda a tela:
         * à esquerda a identidade, os atributos e as abas; à direita a vida
         * e as anotações. Os dois blocos usam o mesmo template de grade, então
         * as colunas nunca "escorregam" uma em relação à outra.
         */}
        <div className="sheet-hud">
          <div className="sheet-hud-main">
            <IdentitySection character={character} update={update} />
            <AbilitiesSection character={character} update={update} />
          </div>
          <div className="sheet-hud-side">
            <VitalsSection character={character} update={update} />
          </div>
        </div>

        <div className="sheet-work">
          <div className="sheet-work-main">
            <div className="sheet-tabs" role="tablist" aria-label="Seções da ficha">
              {TAB_SECTIONS.map((item) => (
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
              {renderTab(tab, character, update)}
            </div>
          </div>

          <div className="sheet-work-side">
            <NotesSection character={character} update={update} />
          </div>
        </div>
      </div>
    </ReadOnlyProvider>
  );
}
