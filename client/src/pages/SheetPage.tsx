import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { AppHeader } from '../components/AppHeader';
import { CreationWizard } from '../components/CreationWizard';
import { Icon } from '../components/Icon';
import { LevelUpDialog } from '../components/LevelUpDialog';
import { PresentationOverlay } from '../components/PresentationOverlay';
import { SheetView } from '../components/SheetView';
import { BagListSection } from '../components/sections/BagListSection';
import { FeaturesSection } from '../components/sections/FeaturesSection';
import { AttacksSection } from '../components/sections/AttacksSection';
import { SpellsSection } from '../components/sections/SpellsSection';
import {
  CombatTracker,
  COMBAT_SHORTCUTS,
  type SheetShortcut,
} from '../combat/CombatTracker';
import { fetchActiveCombat } from '../combat/combatApi';
import { useCombatState } from '../combat/useCombatState';
import { DiceDock } from '../dice/DiceDock';
import { useDiceRoller } from '../dice/useDiceRoller';
import { fetchTransferTargets } from '../coinsApi';
import { fetchGameConfig } from '../gameApi';
import { moveInventoryItem, useInventoryItem } from '../inventoryApi';
import { resultBreakdown } from '../dice/format';
import { closePresentation } from '../presentationApi';
import type {
  Character,
  CharacterPatch,
  GameConfig,
  InventoryMoveRequest,
  Presentation,
  SessionUser,
  TransferTarget,
} from '../types';
import { useRealtime } from '../useRealtime';

export function SheetPage({ user }: { user: SessionUser }) {
  const { logout } = useAuth();
  const [character, setCharacter] = useState<Character | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  // Aviso de que o mestre mexeu na ficha (com quem e quando).
  const [masterNotice, setMasterNotice] = useState<string | null>(null);
  // Resultado do último item consumido (rolagem do efeito, quando houver).
  const [itemNotice, setItemNotice] = useState<string | null>(null);
  // Configuração da mesa: controla se o botão Level Up está habilitado.
  const [gameConfig, setGameConfig] = useState<GameConfig | null>(null);
  const [levelUpOpen, setLevelUpOpen] = useState(false);
  // Destinos possíveis de transferência de moedas (outros jogadores da mesa).
  const [coinTargets, setCoinTargets] = useState<TransferTarget[]>([]);
  // Seção da ficha aberta logo abaixo do painel de combate (ou nenhuma).
  const [combatView, setCombatView] = useState<SheetShortcut | null>(null);

  // Clicar de novo no mesmo atalho fecha a seção aberta.
  const openSheetSection = useCallback((target: SheetShortcut) => {
    setCombatView((current) => (current === target ? null : target));
  }, []);

  const openShortcut = COMBAT_SHORTCUTS.find((item) => item.key === combatView) ?? null;

  const combatState = useCombatState(user.id);
  const { combat, log, turnAlert, dismissTurnAlert } = combatState;

  // Janela de dados (botão flutuante + avisos + rolagens de perícia).
  const dice = useDiceRoller(user);

  const { connection, online, lastEventAt } = useRealtime({
    ...combatState.handlers,
    ...dice.handlers,

    onSheetUpdated: (payload) => {
      // Só aceita a própria ficha e versões mais novas (evita respostas fora de ordem).
      // Também é por aqui que o dano do combate chega ao HP do jogador.
      setCharacter((prev) => {
        if (!prev || prev.id !== payload.character.id) return prev;
        return payload.character.version >= prev.version ? payload.character : prev;
      });

      // `editedBy` só vem quando quem salvou não foi o próprio jogador.
      if (payload.editedBy) {
        const time = new Date(payload.at).toLocaleTimeString('pt-BR');
        setMasterNotice(`${payload.editedBy} (mestre) alterou sua ficha às ${time}.`);
      }
    },

    // O mestre excluiu este personagem: a conta do jogador também foi
    // embora, então a única saída é voltar para o login.
    onCharacterDeleted: (payload) => {
      if (payload.userId === user.id) logout();
    },

    // Imagem que o mestre está mostrando para a mesa.
    onPresentationShown: (payload) => setPresentation(payload.presentation),
    onPresentationClosed: () => setPresentation(null),

    // O mestre liberou/bloqueou o Level Up: o botão reage na hora.
    onGameConfig: (payload) => setGameConfig(payload.config),
  });

  // Carrega a ficha do usuário e o eventual combate em andamento.
  useEffect(() => {
    let active = true;

    Promise.all([
      api<{ character: Character | null }>('/api/characters/me'),
      fetchActiveCombat().catch(() => null),
      fetchGameConfig().catch(() => null),
    ])
      .then(([characterResult, activeCombat, config]) => {
        if (!active) return;
        setCharacter(characterResult.character);
        combatState.setCombat(activeCombat);
        setGameConfig(config);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Não foi possível carregar a ficha.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Aplica a edição inline: atualiza a tela na hora (otimista) e envia o PATCH.
   * A resposta do servidor é a fonte de verdade (traz os valores derivados).
   */
  const update = useCallback(async (patch: CharacterPatch) => {
    // `classes` chega no formato do PATCH (sem nível); mantém a lista atual até
    // a resposta do servidor trazer o DTO completo.
    setCharacter((prev) => (prev ? { ...prev, ...patch, classes: prev.classes } : prev));

    try {
      const { character: saved } = await api<{ character: Character }>('/api/characters/me', {
        method: 'PATCH',
        body: patch,
      });
      setCharacter((prev) => (!prev || saved.version >= prev.version ? saved : prev));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar a alteração.');

      try {
        const fresh = await api<{ character: Character | null }>('/api/characters/me');
        if (fresh.character) {
          setCharacter((prev) =>
            !prev || fresh.character!.version >= prev.version ? fresh.character : prev,
          );
        }
      } catch {
        // Sem rede: mantém o estado local e exibe o erro acima.
      }
    }
  }, []);

  // Lista de outros jogadores, para o seletor de destino da transferência.
  // Refeita só quando a ficha (o personagem) muda — não a cada alteração.
  useEffect(() => {
    if (!character) return;
    let active = true;
    fetchTransferTargets()
      .then((targets) => {
        if (active) setCoinTargets(targets);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [character?.id]);

  /**
   * Move/equipa um item do inventário. Usa o endpoint dedicado (que trata a
   * troca no servidor) e adota a ficha devolvida como fonte de verdade.
   */
  const moveItem = useCallback(async (request: InventoryMoveRequest) => {
    try {
      const saved = await moveInventoryItem(request);
      setCharacter((prev) => (!prev || saved.version >= prev.version ? saved : prev));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível mover o item.');
    }
  }, []);

  /**
   * Usa (consome) 1 unidade de um item consumível do inventário.
   *
   * O servidor desconta a unidade e devolve a ficha nova; se o item tiver
   * `effectRoll`, a rolagem do efeito volta junto e é mostrada no aviso.
   */
  const useItem = useCallback(async (itemInventoryId: string) => {
    try {
      const { character: saved, roll } = await useInventoryItem(itemInventoryId);
      setCharacter((prev) => (!prev || saved.version >= prev.version ? saved : prev));
      setItemNotice(
        roll ? `${roll.label}: ${resultBreakdown(roll)} = ${roll.total}` : 'Item consumido.',
      );
      setError(null);
    } catch (err) {
      setItemNotice(null);
      setError(err instanceof Error ? err.message : 'Não foi possível usar o item.');
    }
  }, []);

  /** Fechamento da imagem apresentada (só o mestre chega aqui na prática). */
  const closePresentedImage = useCallback(() => {
    void closePresentation().catch(() => setPresentation(null));
  }, []);

  /**
   * O jogador sobe de nível enquanto não usou a liberação atual da mesa.
   *
   * Não existe mais estado "bloqueado": o mestre libera, o jogador upa, e uma
   * nova liberação re-arma o botão sem precisar bloquear antes.
   */
  const levelUpAvailable =
    character !== null &&
    gameConfig !== null &&
    character.lastLevelUpRelease < gameConfig.levelUpRelease;

  const levelUpHint = !gameConfig
    ? ''
    : levelUpAvailable
      ? 'O mestre liberou o Level Up!'
      : gameConfig.levelUpRelease === 0
        ? 'O mestre ainda não liberou nenhum Level Up nesta mesa.'
        : 'Você já usou esta liberação. Aguarde o mestre liberar de novo.';

  /** Ações de moedas devolvem a ficha inteira — ela passa a ser a da tela. */
  const adoptCoins = useCallback((saved: Character) => {
    setCharacter((prev) => (!prev || saved.version >= prev.version ? saved : prev));
  }, []);

  /** Aplica a ficha vinda do assistente de criação (a fonte de verdade é dele). */
  const adoptCreatedSheet = useCallback((saved: Character) => {
    setCharacter((prev) => (!prev || saved.version >= prev.version ? saved : prev));
  }, []);

  // O assistente abre sozinho para o jogador sem ficha ou com a criação aberta,
  // e bloqueia o acesso à ficha até o último passo.
  const needsWizard = !loading && (!character || !character.creationFinalized);

  // A criação NÃO esconde o cabeçalho: o jogador troca o tema, silencia o som e
  // acompanha a presença da mesa enquanto monta o personagem.
  if (needsWizard) {
    const draftName = character?.name?.trim() ?? '';
    const wizardTitle =
      draftName && draftName.toLowerCase() !== 'novo personagem' ? draftName : 'Novo aventureiro';

    return (
      <div className="app-shell creation-shell">
        <AppHeader
          title={wizardTitle}
          subtitle="criação de personagem"
          avatarUrl={character?.avatarUrl}
          connection={connection}
          online={online}
          lastEventAt={lastEventAt}
          user={user}
        />

        {error ? (
          <div className="banner banner-error">
            {error}
            <button type="button" className="btn btn-small" onClick={() => setError(null)}>
              fechar
            </button>
          </div>
        ) : null}

        <main className="app-main app-main-wide creation-main">
          <CreationWizard
            user={user}
            onCharacter={adoptCreatedSheet}
            onFinished={adoptCreatedSheet}
          />
        </main>
      </div>
    );
  }

  return (
    <div className={combat ? 'app-shell combat-active' : 'app-shell'}>
      <PresentationOverlay
        presentation={presentation}
        isMaster={user.role === 'MASTER'}
        onClose={closePresentedImage}
      />

      <AppHeader
        title={combat ? `${character?.name ?? 'Sem ficha'} · em combate` : character ? character.name : 'Sem ficha'}
        avatarUrl={character?.avatarUrl}
        connection={connection}
        online={online}
        lastEventAt={lastEventAt}
        user={user}
      />

      {error ? (
        <div className="banner banner-error">
          {error}
          <button type="button" className="btn btn-small" onClick={() => setError(null)}>
            fechar
          </button>
        </div>
      ) : null}

      {itemNotice ? (
        <div className="banner banner-info">
          <span className="banner-line">
            <Icon name="flask" size={15} /> {itemNotice}
          </span>
          <button type="button" className="btn btn-small" onClick={() => setItemNotice(null)}>
            fechar
          </button>
        </div>
      ) : null}

      {masterNotice ? (
        <div className="banner banner-info">
          <span className="banner-line">
            <Icon name="quill" size={15} /> {masterNotice}
          </span>
          <button type="button" className="btn btn-small" onClick={() => setMasterNotice(null)}>
            fechar
          </button>
        </div>
      ) : null}

      <main className="app-main app-main-wide">
        {loading ? (
          <p className="splash">Carregando a ficha...</p>
        ) : (
          <>
            {combat ? (
              <CombatTracker
                combat={combat}
                log={log}
                user={user}
                turnAlert={turnAlert}
                onDismissTurnAlert={dismissTurnAlert}
                characterAttacks={[
                  ...(character?.attacks ?? []),
                  ...(character?.derivedAttacks ?? []),
                ]}
                characterInventory={character?.inventory ?? []}
                sneakAttackExpression={character?.derived.sneakAttack?.expression ?? null}
                onCombatChange={combatState.setCombat}
                onCombatEnd={() => combatState.setCombat(null)}
                onError={setError}
                onOpenSection={openSheetSection}
                openSection={combatView}
              />
            ) : null}

            {/* Atalhos do combate: a seção abre aqui embaixo, sem tirar o
                jogador do painel de batalha. */}
            {combat && combatView && character ? (
              <section className="combat-view" aria-label={openShortcut?.label}>
                <div className="combat-view-head">
                  <h2>
                    <Icon name={openShortcut?.icon ?? 'book'} size={16} />
                    {openShortcut?.label}
                  </h2>
                  <button
                    type="button"
                    className="btn btn-small"
                    aria-label="Fechar esta seção"
                    onClick={() => setCombatView(null)}
                  >
                    ×
                  </button>
                </div>

                {combatView === 'spells' ? (
                  <SpellsSection character={character} update={update} />
                ) : null}
                {combatView === 'attacks' ? (
                  <AttacksSection character={character} update={update} />
                ) : null}
                {combatView === 'features' ? (
                  <FeaturesSection character={character} update={update} />
                ) : null}
                {combatView === 'inventory' ? <BagListSection character={character} /> : null}
              </section>
            ) : null}

            {/* Sem ficha o assistente de criação já tomou a tela (ver
                `needsWizard` acima); aqui a ficha está montada e em jogo. */}
            {character ? (
              <>
                <div className="levelup-bar">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!levelUpAvailable}
                    onClick={() => setLevelUpOpen(true)}
                  >
                    <Icon name="sparkle" size={16} /> Level Up
                  </button>
                  {levelUpHint ? <span className="levelup-hint">{levelUpHint}</span> : null}

                  {/* A criação já foi finalizada: a montagem só muda pelo Level Up
                      ou pelo mestre (o mestre pode reabrir a criação pelo painel). */}
                  <span className="levelup-hint creation-locked-hint">
                    <Icon name="quill" size={14} /> criação finalizada: a montagem só muda pelo
                    Level Up (ou pelo mestre)
                  </span>
                </div>

                <SheetView
                  character={character}
                  update={update}
                  onInventoryMove={moveItem}
                  onInventoryUse={useItem}
                  extraCoins={gameConfig?.extraCoins ?? false}
                  coinTargets={coinTargets}
                  onCoinsChange={adoptCoins}
                  onRollSkill={dice.openSkillRoll}
                  creationLocked={character.creationFinalized}
                />

                {levelUpOpen && levelUpAvailable ? (
                  <LevelUpDialog
                    character={character}
                    onClose={() => setLevelUpOpen(false)}
                    onApplied={(updated) =>
                      setCharacter((prev) => (!prev || updated.version >= prev.version ? updated : prev))
                    }
                  />
                ) : null}
              </>
            ) : null}
          </>
        )}
      </main>

      {/* Botão "Dados" sempre disponível, em qualquer tela do jogo. */}
      <DiceDock roller={dice} />
    </div>
  );
}
