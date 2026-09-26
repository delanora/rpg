import { useState } from 'react';
import type { Character } from '../../types';
import { SheetView } from '../SheetView';

/** A visão do mestre é somente leitura: este callback nunca é chamado. */
const noop = (): void => {};

interface SheetsTabProps {
  characters: Character[];
}

export function SheetsTab({ characters }: SheetsTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Derivado da lista: uma atualização em tempo real já reflete no detalhe.
  const selected = characters.find((character) => character.id === selectedId) ?? null;

  if (characters.length === 0) {
    return <p className="empty-hint">Nenhum jogador criou ficha ainda.</p>;
  }

  return (
    <div className="master-layout">
      <aside className="master-list">
        <ul className="character-cards">
          {characters.map((character) => (
            <li key={character.id}>
              <button
                type="button"
                className={selected?.id === character.id ? 'character-card active' : 'character-card'}
                onClick={() => setSelectedId(character.id)}
              >
                <span className="card-name">{character.name}</span>
                <span className="card-owner">{character.ownerUsername ?? '—'}</span>
                <span className="card-line">
                  {character.className || 'sem classe'} · Nv {character.level} · CA{' '}
                  {character.armorClass}
                </span>
                <span className="card-hp">
                  HP {character.hpCurrent}/{character.hpMax}
                  {character.hpTemp > 0 ? ` (+${character.hpTemp})` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="master-detail">
        {selected ? (
          <>
            <div className="detail-head">
              <h2>{selected.name}</h2>
              <span className="detail-meta">
                jogador: {selected.ownerUsername} · atualizado às{' '}
                {new Date(selected.updatedAt).toLocaleTimeString('pt-BR')} · somente leitura
              </span>
            </div>
            <SheetView character={selected} update={noop} readOnly />
          </>
        ) : (
          <p className="empty-hint">Selecione uma ficha para ver todos os detalhes.</p>
        )}
      </section>
    </div>
  );
}
