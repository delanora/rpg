import { useState } from 'react';
import type { Character, CharacterPatch, LevelDownRequest, LevelDownResult } from '../../types';
import { Icon } from '../Icon';
import { Portrait } from '../Portrait';
import { SheetView } from '../SheetView';
import { DeleteCharacterDialog } from './DeleteCharacterDialog';
import { LevelDownDialog } from './LevelDownDialog';

interface SheetsTabProps {
  characters: Character[];
  /** Edição da ficha de um jogador pelo mestre (`PATCH /api/characters/:id`). */
  onUpdate: (characterId: string, patch: CharacterPatch) => void;
  /**
   * Exclui a ficha **e a conta do jogador** (`DELETE /api/characters/:id`).
   * Deve rejeitar quando falhar, para o diálogo mostrar o erro.
   */
  onDelete: (characterId: string) => Promise<void>;
  /**
   * Devolve a criação ao jogador (`POST /api/characters/:id/creation/reopen`):
   * a ficha volta a ficar em montagem e o assistente reabre no próximo acesso
   * dele, com o que já existe preenchido.
   */
  onReopenCreation: (characterId: string) => Promise<void>;
  /**
   * Reduz UM nível do personagem (`POST /api/characters/:id/level-down`): o
   * inverso do Level Up. Deve rejeitar quando falhar, para a janela mostrar o
   * erro, e devolver a ficha já revertida.
   */
  onLevelDown: (characterId: string, request: LevelDownRequest) => Promise<LevelDownResult>;
  /** Denominações extras (PL/PE) ligadas pelo mestre na aba Mesa. */
  extraCoins: boolean;
  /** Ação de moedas devolveu a ficha inteira — atualiza a lista do painel. */
  onCoinsChange: (character: Character) => void;
}

/**
 * Aba de fichas dos jogadores. O mestre abre qualquer ficha em **somente
 * leitura** e pode entrar em modo de edição — aí a mesma ficha do jogador
 * (com todos os controles) fica disponível, e cada alteração salva na hora.
 * Também é daqui que ele **exclui um personagem** (com a conta do jogador),
 * sempre passando pela confirmação.
 */
export function SheetsTab({
  characters,
  onUpdate,
  onDelete,
  onReopenCreation,
  onLevelDown,
  extraCoins,
  onCoinsChange,
}: SheetsTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [levelingDown, setLevelingDown] = useState(false);
  // Derivado da lista: uma atualização em tempo real já reflete no detalhe.
  const selected = characters.find((character) => character.id === selectedId) ?? null;

  function selectCharacter(id: string): void {
    setSelectedId(id);
    // Trocar de ficha volta ao modo leitura, para não editar a pessoa errada.
    setEditing(false);
    setConfirmingDelete(false);
    setLevelingDown(false);
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
                  HP {character.hpCurrent}/{character.derived.hpMax}
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
                  {editing ? 'editando' : 'somente leitura'} ·{' '}
                  {selected.creationFinalized ? 'criação finalizada' : 'criação em andamento'}
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

                <button
                  type="button"
                  className="btn btn-small"
                  disabled={reopening || !selected.creationFinalized}
                  title={
                    selected.creationFinalized
                      ? 'Devolver a ficha ao assistente de criação: o jogador refaz a montagem no próximo acesso'
                      : 'Esta ficha já está em criação'
                  }
                  onClick={() => {
                    setReopening(true);
                    void onReopenCreation(selected.id).finally(() => setReopening(false));
                  }}
                >
                  <Icon name="scroll" size={14} />{' '}
                  {reopening ? 'reabrindo...' : 'reabrir criação'}
                </button>

                <button
                  type="button"
                  className="btn btn-small"
                  disabled={selected.classes.length === 0}
                  title="Reduzir UM nível do personagem e reverter o que aquele nível concedeu"
                  onClick={() => setLevelingDown(true)}
                >
                  <Icon name="scroll" size={14} /> reduzir nível
                </button>

                <button
                  type="button"
                  className="btn btn-danger btn-small"
                  onClick={() => setConfirmingDelete(true)}
                  title="Excluir o personagem e a conta do jogador (não pode ser desfeito)"
                >
                  <Icon name="trash" size={14} /> excluir personagem
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
              extraCoins={extraCoins}
              onCoinsChange={onCoinsChange}
              readOnly={!editing}
              masterView
            />

            {levelingDown ? (
              <LevelDownDialog
                character={selected}
                onClose={() => setLevelingDown(false)}
                apply={(request) => onLevelDown(selected.id, request)}
              />
            ) : null}

            {confirmingDelete ? (
              <DeleteCharacterDialog
                character={selected}
                onCancel={() => setConfirmingDelete(false)}
                onConfirm={() => onDelete(selected.id)}
              />
            ) : null}
          </>
        ) : (
          <p className="empty-hint">Selecione uma ficha para ver todos os detalhes.</p>
        )}
      </section>
    </div>
  );
}
