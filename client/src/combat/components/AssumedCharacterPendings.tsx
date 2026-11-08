import type { CombatantDto, CombatResolutionCardDto, ConcentrationSave } from '../../types';
import { ConcentrationSavePanel } from './ConcentrationSavePanel';
import { ResolutionCard } from './ResolutionCard';

/** Cards já derivados no servidor; aceita ficha canônica ou instância do combate. */
export function pendingsForCharacter(cards: readonly CombatResolutionCardDto[], character: CombatantDto | null): CombatResolutionCardDto[] {
  if (!character || character.kind !== 'CHARACTER') return [];
  return cards.filter(card => {
    const entity = card.reference.entity ?? card.target;
    return entity.kind === 'character' ? entity.id === character.characterId :
      entity.kind === 'combatant' && entity.id === character.id;
  });
}

/** Superfície do Mestre: mesmas rotas e pendências, com resultado público do personagem. */
export function AssumedCharacterPendings({ character, cards, busy, onRollDeath, onRollSpell, onDecline, onRollConcentration }: {
  character: CombatantDto; cards: CombatResolutionCardDto[]; busy: boolean;
  onRollDeath: (card: CombatResolutionCardDto) => void;
  onRollSpell: (card: CombatResolutionCardDto, selected: string[], visibility: 'public' | 'private' | null) => void;
  onDecline: (card: CombatResolutionCardDto) => void;
  onRollConcentration: (save: ConcentrationSave) => void;
}) {
  if (character.kind !== 'CHARACTER') return null;
  const saves = character.mechanicalState.pendingConcentrationSaves ?? [];
  if (!cards.length && !saves.length) return null;
  return <section className="assumed-character-pendings" aria-label={`Pendências de ${character.name}`}>
    <p className="assumed-character-heading">Respondendo por <strong>{character.name}</strong></p>
    {cards.map(card => <ResolutionCard key={card.id} card={card} busy={busy} publicOnly
      onRollDeath={onRollDeath} onRollSpell={(entry, selected) => onRollSpell(entry, selected, 'public')} onDecline={onDecline} />)}
    <ConcentrationSavePanel name={character.name} saves={saves} isMaster={false}
      canRoll busy={busy} onRollPlayer={onRollConcentration} />
  </section>;
}
