import { useState } from 'react';
import type { Character, CharacterPatch } from '../../types';
import { Icon } from '../Icon';
import { Portrait } from '../Portrait';
import { SheetView } from '../SheetView';

interface SheetsTabProps {
  characters: Character[];
  /** Edição da ficha de um jogador pelo mestre (`PATCH /api/characters/:id`). */
  onUpdate: (characterId: string, patch: CharacterPatch) => void;
}

/**
 * Aba de fichas dos jogadores. O mestre abre qualquer ficha em **somente
 * leitura** e pode entrar em modo de edição — aí a mesma ficha do jogador
 * (com todos os controles) fica disponível, e cada alteração salva na hora.
 */
export function SheetsTab({ characters, onUpdate }: SheetsTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  // Derivado da lista: uma atualização em tempo real já reflete no detalhe.
  const selected = characters.find((character) => character.id === selectedId) ?? null;

  function selectCharacter(id: string): void {
    setSelectedId(id);
    // Trocar de ficha volta ao modo leitura, para não editar a pessoa errada.
    setEditing(false);
  }

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
                onClick={() => selectCharacter(character.id)}
              >
                <span className="card-head">
                  <Portrait src={character.avatarUrl} alt={character.name} icon="users" />
                  <span className="card-name">{character.name}</span>
                </span>
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

              <div className="detail-head-actions">
                <span className="detail-meta">
                  jogador: {selected.ownerUsername} · atualizado às{' '}
                  {new Date(selected.updatedAt).toLocaleTimeString('pt-BR')} ·{' '}
                  {editing ? 'editando' : 'somente leitura'}
                </span>

                <button
                  type="button"
                  className={editing ? 'btn btn-primary btn-small' : 'btn btn-small'}
                  onClick={() => setEditing((value) => !value)}
                  title={
                    editing
                      ? 'Voltar a visualizar a ficha sem editar'
                      : 'Editar a ficha deste jogador'
                  }
                >
                  <Icon name={editing ? 'eye' : 'quill'} size={14} />
                  {editing ? 'concluir edição' : 'editar ficha'}
                </button>
              </div>
            </div>

            {editing ? (
              <p className="empty-hint">
                As alterações vão direto para a ficha de {selected.name} — o jogador vê tudo na
                tela dele na hora.
              </p>
            ) : null}

            <SheetView
              character={selected}
              update={(patch) => onUpdate(selected.id, patch)}
              readOnly={!editing}
            />
          </>
        ) : (
          <p className="empty-hint">Selecione uma ficha para ver todos os detalhes.</p>
        )}
      </section>
    </div>
  );
}
