import { useState } from 'react';
import { SheetAccessProvider } from '../readonly';
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
  /** Abre a janela de dados com 1d20 + bônus da perícia/salvaguarda. */
  onRollSkill?: (input: { kind: 'skill' | 'save'; label: string; bonus: number }) => void;
  /** Em `true`, nenhum campo é editável (visão do mestre). */
  readOnly?: boolean;
  /**
   * Criação finalizada: o jogador só mexe no estado de jogo. Fica `false` no
   * painel do mestre, que edita tudo a qualquer momento.
   */
  creationLocked?: boolean;
  /** Aberta no painel do mestre (habilita o que só ele pode, como a CA manual). */
  masterView?: boolean;
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
 * Ficha em forma de HUD: Identidade ocupa a largura toda no topo; abaixo dela
 * ficam lado a lado o inventário, os atributos e vida e defesa; e na sequência
 * perícias, anotações e as abas (magias, ataques, características).
 * Reutilizada pelo jogador e pelo mestre.
 */
export function SheetView({
  character,
  update,
  onInventoryMove,
  onRollSkill,
  readOnly = false,
  creationLocked = false,
  masterView = false,
}: SheetViewProps) {
  const [tab, setTab] = useState<TabKey>('spells');
  // Anotações vivem num painel flutuante, abertas pelo botão de pena.
  const [notesOpen, setNotesOpen] = useState(false);
  const active = TAB_SECTIONS.find((item) => item.key === tab) ?? TAB_SECTIONS[0];

  return (
    <SheetAccessProvider value={{ readOnly, creationLocked, masterView }}>
      {/* `position: fixed` no botão e no painel: não participam da grade. */}
      <div className="sheet">
        {/* Identidade de ponta a ponta, no topo da ficha. */}
        <div className="sheet-identity">
          <IdentitySection character={character} update={update} />
        </div>

        {/* Linha logo abaixo: inventário, atributos e vida e defesa. */}
        <div className="sheet-inventory">
          <InventorySection character={character} update={update} onMoveItem={onInventoryMove} />
        </div>

        <div className="sheet-abilities">
          <AbilitiesSection character={character} update={update} />
        </div>

        <div className="sheet-vitals">
          <VitalsSection character={character} update={update} />
        </div>

        {/* Perícias e salvaguardas ocupam a largura toda. */}
        <div className="sheet-skills">
          <SkillsSavesSection character={character} update={update} onRoll={onRollSkill} />
        </div>

        <div className="sheet-tabs-area">
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

        {/* Anotações e história: botão flutuante no canto inferior direito. */}
        <button
          type="button"
          className={notesOpen ? 'notes-fab active' : 'notes-fab'}
          aria-expanded={notesOpen}
          aria-controls="sheet-notes-panel"
          title={notesOpen ? 'Fechar anotações' : 'Abrir anotações e história'}
          onClick={() => setNotesOpen((value) => !value)}
        >
          <Icon name="quill" size={18} />
          <span className="notes-fab-label">Anotações</span>
        </button>

        {notesOpen ? (
          <div
            className="notes-drawer"
            id="sheet-notes-panel"
            role="dialog"
            aria-label="Anotações e história"
          >
            <button
              type="button"
              className="notes-drawer-close"
              aria-label="Fechar anotações"
              onClick={() => setNotesOpen(false)}
            >
              ×
            </button>
            <NotesSection character={character} update={update} />
          </div>
        ) : null}
      </div>
    </SheetAccessProvider>
  );
}
