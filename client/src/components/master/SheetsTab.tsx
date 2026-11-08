import { useMemo, useState } from 'react';
import type { Character, CharacterPatch, LevelDownRequest, LevelDownResult } from '../../types';
import { Icon } from '../Icon';
import { Portrait } from '../Portrait';
import { SheetView } from '../SheetView';
import { DeleteCharacterDialog } from './DeleteCharacterDialog';
import { LevelDownDialog } from './LevelDownDialog';
import { MasterDetailModal } from './MasterDetailModal';
import { Paginator, paginate, usePager } from './Paginator';
import { SearchField } from './SearchField';
import { matchesSearch } from './search';

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
  /** Regra OPCIONAL de Exaustão ligada pelo mestre (aba Mesa). */
  exhaustionEnabled: boolean;
  /** Ação de moedas devolveu a ficha inteira — atualiza a lista do painel. */
  onCoinsChange: (character: Character) => void;
}

/**
 * Aba de fichas dos jogadores.
 *
 * A lista ocupa a largura toda em **cards** (mesma linguagem do catálogo de
 * itens), paginada de 25 em 25, com busca no topo. Clicar num card abre a ficha
 * completa numa **janela flutuante**, em somente leitura, com o botão de editar
 * no cabeçalho — aí a mesma ficha do jogador (com todos os controles) fica
 * disponível e cada alteração salva na hora. Também é daqui que o mestre
 * **exclui um personagem** (com a conta do jogador) e reduz nível, sempre
 * passando por confirmação.
 */
export function SheetsTab({
  characters,
  onUpdate,
  onDelete,
  onReopenCreation,
  onLevelDown,
  extraCoins,
  exhaustionEnabled,
  onCoinsChange,
}: SheetsTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [levelingDown, setLevelingDown] = useState(false);
  // Derivado da lista: uma atualização em tempo real já reflete no detalhe.
  const selected = characters.find((character) => character.id === selectedId) ?? null;
  // Busca local: filtra os cards sem fechar a ficha aberta na janela.
  const visible = characters.filter((character) =>
    matchesSearch(query, character.name, character.ownerUsername, character.className),
  );
  // 25 fichas por página; a busca reinicia a paginação (ver `usePager`).
  const pager = usePager(visible.length, query);
  const page = useMemo(() => paginate(visible, pager.page), [visible, pager.page]);

  function openCharacter(id: string): void {
    setSelectedId(id);
    // Abrir outra ficha volta ao modo leitura, para não editar a pessoa errada.
    setEditing(false);
    setConfirmingDelete(false);
    setLevelingDown(false);
  }

  function closeCharacter(): void {
    setSelectedId(null);
    setEditing(false);
    setConfirmingDelete(false);
    setLevelingDown(false);
  }

  if (characters.length === 0) {
    return <p className="empty-hint">Nenhum jogador criou ficha ainda.</p>;
  }

  return (
    <div className="master-catalog">
      <header className="items-head">
        <div className="items-toolbar">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Buscar por nome, jogador ou classe"
            label="Buscar fichas"
          />
        </div>
      </header>

      <div className="items-grid">
        {visible.length === 0 ? (
          <p className="empty-hint">Nenhuma ficha corresponde à busca.</p>
        ) : (
          <ul className="items-cards">
            {page.items.map((character) => (
              <li key={character.id}>
                <button
                  type="button"
                  className="items-card"
                  aria-label={`Abrir a ficha de ${character.name}`}
                  onClick={() => openCharacter(character.id)}
                >
                  <Portrait
                    src={character.avatarUrl}
                    alt={character.name}
                    size="lg"
                    icon="users"
                    zoomable={false}
                  />
                  <span className="items-card-body">
                    <span className="items-card-name">{character.name}</span>
                    <span className="items-card-tags">
                      <span className="items-card-tag">{character.className || 'sem classe'}</span>
                      <span className="items-card-tag">Nv {character.level}</span>
                      {character.creationFinalized ? null : (
                        <span className="items-card-tag">criação em andamento</span>
                      )}
                    </span>
                    <span className="items-card-meta">
                      {character.ownerUsername ?? '—'} · CA {character.armorClass}
                    </span>
                    <span className="items-card-summary">
                      HP {character.hpCurrent}/{character.derived.hpMax}
                      {character.hpTemp > 0 ? ` (+${character.hpTemp})` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {visible.length > 0 ? (
        <Paginator
          page={page.page}
          pageCount={page.pageCount}
          total={page.total}
          start={page.start}
          end={page.end}
          onPage={pager.setPage}
          one="ficha"
          many="fichas"
          label="Paginação das fichas"
          detail={query ? `${visible.length} de ${characters.length} com a busca atual` : undefined}
        />
      ) : null}

      {selected ? (
        <MasterDetailModal
          kind="Ficha"
          title={selected.name}
          subtitle={
            <>
              jogador: {selected.ownerUsername} · atualizado às{' '}
              {new Date(selected.updatedAt).toLocaleTimeString('pt-BR')} ·{' '}
              {editing ? 'editando' : 'somente leitura'} ·{' '}
              {selected.creationFinalized ? 'criação finalizada' : 'criação em andamento'}
            </>
          }
          suspended={confirmingDelete || levelingDown}
          size="sheet"
          onClose={closeCharacter}
          actions={
            <>
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
            </>
          }
        >
          {editing ? (
            <p className="empty-hint">
              As alterações vão direto para a ficha de {selected.name} — o jogador vê tudo na tela
              dele na hora.
            </p>
          ) : null}

          <SheetView
            character={selected}
            update={(patch) => onUpdate(selected.id, patch)}
            extraCoins={extraCoins}
            exhaustionEnabled={exhaustionEnabled}
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
        </MasterDetailModal>
      ) : null}
    </div>
  );
}
