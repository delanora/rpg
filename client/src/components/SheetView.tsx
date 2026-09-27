import { useState } from 'react';
import { ReadOnlyProvider } from '../readonly';
import type { Character, CharacterPatch, InventoryMoveRequest } from '../types';
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

/**
 * Seções que vivem em abas. Perícias e inventário não entram aqui: a primeira
 * fica sempre visível abaixo dos atributos e o inventário ocupa uma coluna
 * lateral própria, ambos fora das abas.
 */
const TAB_SECTIONS = [
  { key: 'spells', label: 'Magias', icon: 'star' },
  { key: 'attacks', label: 'Ataques', icon: 'sword' },
  { key: 'features', label: 'Características', icon: 'book' },
] as const satisfies readonly { key: string; label: string; icon: IconName }[];

type TabKey = (typeof TAB_SECTIONS)[number]['key'];

interface SheetViewProps {
  character: Character;
  update: (patch: CharacterPatch) => void;
  /** Move/equipa um item do inventário (endpoint dedicado do servidor). */
  onInventoryMove?: (request: InventoryMoveRequest) => void | Promise<void>;
  /** Em `true`, nenhum campo é editável (visão do mestre). */
  readOnly?: boolean;
}

function renderTab(key: TabKey, character: Character, update: (patch: CharacterPatch) => void) {
  switch (key) {
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
 * à vista; o inventário ocupa uma coluna lateral fixa (independente da aba) e
 * só magias, ataques e características vivem em abas. Reutilizada pelo jogador
 * e pelo mestre.
 */
export function SheetView({ character, update, onInventoryMove, readOnly = false }: SheetViewProps) {
  const [tab, setTab] = useState<TabKey>('spells');
  const active = TAB_SECTIONS.find((item) => item.key === tab) ?? TAB_SECTIONS[0];

  return (
    <ReadOnlyProvider value={readOnly}>
      <div className="sheet">
        {/*
         * Uma única grade de três colunas: o corpo da ficha (identidade,
         * atributos, perícias e as abas), vida e anotações, e o inventário na
         * coluna lateral. O conteúdo flui em cada coluna, sem buracos.
         */}
        <div className="sheet-main">
          <IdentitySection character={character} update={update} />
          <AbilitiesSection character={character} update={update} />
          <SkillsSavesSection character={character} update={update} />

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

        <div className="sheet-side">
          <VitalsSection character={character} update={update} />
          <NotesSection character={character} update={update} />
        </div>

        {/* Coluna lateral própria: o inventário fica sempre à vista, fora das abas. */}
        <aside className="sheet-inventory" aria-label="Inventário">
          <InventorySection character={character} update={update} onMoveItem={onInventoryMove} />
        </aside>
      </div>
    </ReadOnlyProvider>
  );
}
