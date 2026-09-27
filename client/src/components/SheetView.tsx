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
 * Seções que vivem em abas. Perícias não entra aqui: ela fica sempre visível
 * logo abaixo dos atributos, junto do resto do HUD.
 */
const TAB_SECTIONS = [
  { key: 'inventory', label: 'Inventário', icon: 'bag' },
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

function renderTab(
  key: TabKey,
  character: Character,
  update: (patch: CharacterPatch) => void,
  onInventoryMove?: (request: InventoryMoveRequest) => void | Promise<void>,
) {
  switch (key) {
    case 'inventory':
      return (
        <InventorySection character={character} update={update} onMoveItem={onInventoryMove} />
      );
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
export function SheetView({ character, update, onInventoryMove, readOnly = false }: SheetViewProps) {
  const [tab, setTab] = useState<TabKey>('inventory');
  const active = TAB_SECTIONS.find((item) => item.key === tab) ?? TAB_SECTIONS[0];

  return (
    <ReadOnlyProvider value={readOnly}>
      <div className="sheet">
        {/*
         * Uma única grade de duas colunas: à esquerda identidade, atributos,
         * perícias e as abas; à direita vida e anotações. O conteúdo flui em
         * cada coluna, sem deixar buracos no meio da página.
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
            {renderTab(tab, character, update, onInventoryMove)}
          </div>
        </div>

        <div className="sheet-side">
          <VitalsSection character={character} update={update} />
          <NotesSection character={character} update={update} />
        </div>
      </div>
    </ReadOnlyProvider>
  );
}
