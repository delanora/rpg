import { useState } from 'react';
import { Icon } from '../../components/Icon';
import type { TurnEconomy } from '../../types';
import {
  HOTBAR_SLOTS,
  hotbarFilterLabel,
  hotbarSlotSpent,
  type CombatHotbarEntry,
  type HotbarCost,
  type HotbarFilter,
  type HotbarSlotRef,
  type HotbarSlotView,
} from '../hotbar';

/** Letra do custo no rótulo acessível e na prévia (A = Ação, B = Bônus, R = Reação). */
const COST_LABEL: Record<HotbarCost, string> = {
  action: 'Ação',
  'bonus-action': 'Ação Bônus',
  reaction: 'Reação',
  other: 'custo definido pelo servidor',
};

interface CombatHotbarProps {
  /** Posições JÁ resolvidas (e, fora do editor, mascaradas pelo filtro). */
  slots: HotbarSlotView[];
  busy: boolean;
  /** Entrada escolhida (marca o slot). Só visual: quem envia é o fluxo existente. */
  selectedId?: string | null;
  /** Filtro ativo (navegação A/B/R). Só máscara de visualização. */
  filter?: HotbarFilter | null;
  onSelect: (entry: CombatHotbarEntry) => void;

  // ---------------------------------------------------------------------
  // Personalização (6.6M.6.3.1) — o GESTO de abrir o editor vive na dock, ao
  // lado do retrato (`dock-personalize`); aqui só existe o editor já aberto.
  // Sem `editing` a Hotbar é somente consulta.
  // ---------------------------------------------------------------------
  editing?: boolean;
  /** Rascunho do editor (configuração COMPLETA, sem máscara de filtro). */
  draftSlots?: HotbarSlotView[];
  /** Atalhos disponíveis para adicionar a uma posição vazia. */
  choices?: CombatHotbarEntry[];
  error?: string | null;
  /** Envio em curso: a grade não aceita novos cliques. */
  saving?: boolean;
  onAssign?: (index: number, ref: HotbarSlotRef) => void;
  onMove?: (from: number, to: number) => void;
  onRemove?: (index: number) => void;
  /** Entradas disponíveis que ficaram FORA da grade (lista "ver todas"). */
  extraEntries?: CombatHotbarEntry[];
  /**
   * Economia do turno do PRÓPRIO personagem (vem do servidor). Só serve para
   * ESCURECER o que já gastou o recurso (6.6M.6.3.1.2) — nada é cobrado aqui.
   */
  economy?: TurnEconomy | null;
}

/**
 * HOTBAR DE COMBATE — GRADE DE 48 SLOTS (2×24) + EDITOR DE POSIÇÕES.
 *
 * Esta é uma SUPERFÍCIE DE ACESSO: mostra o que o personagem já possui e
 * encaminha o clique para o fluxo existente (painel de ataque, alvo, modo de
 * rolagem, munição, modificadores, envio ao servidor). O componente não calcula
 * regra, não cobra economia e não resolve nada sozinho.
 *
 * 6.6M.6.3.1: as posições passaram a ser PERSISTIDAS. O editor abre pelo lápis
 * junto ao retrato, trabalha sobre um RASCUNHO local (adicionar, mover, trocar,
 * remover); o check verde ao lado do lápis envia ao servidor e o próprio lápis
 * descarta o rascunho. A faixa do topo não explica o modo: ela fica vazia em
 * edição para a grade não mudar de tamanho.
 *
 * 6.6M.6.3.1.1: o filtro A/B/R NÃO encolhe a grade. A categoria escolhida vem
 * para o começo da Hotbar e os demais atalhos continuam ali, esmaecidos — só
 * que a posição DESENHADA é do filtro, nunca da configuração salva.
 *
 * Nada aqui executa ação: salvar organização é preferência de interface.
 */
export function CombatHotbar({
  slots,
  busy,
  selectedId = null,
  filter = null,
  onSelect,
  editing = false,
  draftSlots,
  choices = [],
  error = null,
  saving = false,
  onAssign,
  onMove,
  onRemove,
  extraEntries = [],
  economy = null,
}: CombatHotbarProps) {
  /** Slot vazio esperando a escolha de um atalho (picker aberto). */
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  /** Slot escolhido para mover/trocar (alternativa acessível ao arrastar). */
  const [movingFrom, setMovingFrom] = useState<number | null>(null);

  if (!editing && slots.length === 0 && !filter) return null;

  const views = editing ? (draftSlots ?? []) : slots;
  const visibleCount = editing ? views.filter((slot) => slot.ref).length : slots.length;

  /** Clique/teclado num slot do editor: mover, trocar ou abrir o seletor. */
  const pickSlot = (index: number, ref: HotbarSlotRef | null): void => {
    if (movingFrom !== null) {
      onMove?.(movingFrom, index);
      setMovingFrom(null);
      setPickerFor(null);
      return;
    }
    setPickerFor(null);
    if (ref) setMovingFrom(index);
    else setPickerFor(index);
  };

  const stopEditing = (): void => {
    setPickerFor(null);
    setMovingFrom(null);
  };

  // Sair da edição (Salvar ou o lápis) descarta a seleção interna: reabrir o
  // editor nunca herda "posição escolhida" nem picker aberto. O reset acontece
  // no próprio render (antes de pintar), sem hook de efeito.
  const [editingBefore, setEditingBefore] = useState(editing);
  if (editingBefore !== editing) {
    setEditingBefore(editing);
    setPickerFor(null);
    setMovingFrom(null);
  }

  const emptyFilter =
    !editing && filter && slots.every((slot) => slot.state !== 'ready')
      ? `Nenhuma opção de ${hotbarFilterLabel(filter)} nesta Hotbar`
      : null;

  return (
    <section
      className={editing ? 'combat-hotbar is-editing' : 'combat-hotbar'}
      aria-label={editing ? 'Personalização da Hotbar' : 'Ações rápidas do turno'}
    >
      {/* Linha discreta do topo: aviso de categoria vazia e controles do editor.
          Não há cabeçalho, título nem contador permanente. */}
      <div className="hotbar-tail">
        {/* A faixa NÃO explica o modo de edição nem avisa "não salvo": em
            edição ela não escreve nada, então a linha do topo mede o MESMO que
            fora da edição e a grade não muda de tamanho. Só o erro aparece. */}
        <span className="hotbar-note" role="status">
          {emptyFilter ?? error}
        </span>

        {/* A linha do topo NÃO tem botão: Salvar e Cancelar vivem na dock, ao
            lado do retrato. Aqui só fica o aviso curto de estado. */}
      </div>

      <div
        className="hotbar-slots"
        role="toolbar"
        aria-label={editing ? 'Posições da Hotbar (em edição)' : 'Hotbar de combate'}
      >
        {views.map((slot) => {
          const entry = slot.entry;

          // ---------------------------------------------------------------
          // FORA DA CATEGORIA FILTRADA: continua desenhado (grade completa),
          // só que esmaecido e sem clique. Nada some da Hotbar ao filtrar.
          // ---------------------------------------------------------------
          if (slot.masked) {
            return (
              <span
                key={`hotbar-masked-${slot.index}`}
                className="hotbar-slot is-masked"
                data-slot={slot.index}
                aria-hidden="true"
              >
                <span className="hotbar-slot-key">{slot.index}</span>
                {entry ? <Icon name={entry.icon} size={18} /> : null}
              </span>
            );
          }

          // ---------------------------------------------------------------
          // EDITOR: cada posição é um alvo de arrastar/clicar.
          // ---------------------------------------------------------------
          if (editing) {
            const label =
              entry?.label ?? slot.label ?? (slot.ref ? 'Atalho indisponível' : 'Posição vazia');
            const moving = movingFrom === slot.index;
            return (
              <div
                key={`hotbar-edit-${slot.index}`}
                className={[
                  'hotbar-slot',
                  'is-editable',
                  slot.ref ? '' : 'is-empty',
                  moving ? 'is-moving' : '',
                  slot.state === 'unavailable' || slot.state === 'missing' ? 'is-unavailable' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                data-slot={slot.index}
                role="button"
                tabIndex={0}
                aria-label={`${slot.index}. ${label}${
                  slot.ref ? ' — Enter move, × remove' : ' — Enter escolhe um atalho'
                }`}
                draggable={Boolean(slot.ref) && !saving}
                onDragStart={(event) => {
                  if (!slot.ref) return;
                  setMovingFrom(slot.index);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', String(slot.index));
                }}
                onDragOver={(event) => {
                  if (movingFrom === null) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const from = Number(event.dataTransfer.getData('text/plain'));
                  if (Number.isInteger(from) && from > 0) onMove?.(from, slot.index);
                  setMovingFrom(null);
                }}
                onClick={() => pickSlot(slot.index, slot.ref)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    pickSlot(slot.index, slot.ref);
                  } else if (event.key === 'Escape') {
                    event.stopPropagation();
                    stopEditing();
                  }
                }}
              >
                <span className="hotbar-slot-key" aria-hidden="true">
                  {slot.index}
                </span>
                {entry ? (
                  <Icon name={entry.icon} size={18} />
                ) : slot.ref ? (
                  <span className="hotbar-slot-flag" aria-hidden="true">
                    {slot.state === 'missing' ? 'ausente' : 'sem arma'}
                  </span>
                ) : (
                  <span className="hotbar-slot-plus" aria-hidden="true">
                    +
                  </span>
                )}

                {slot.ref ? (
                  <button
                    type="button"
                    className="hotbar-slot-remove"
                    aria-label={`Remover o atalho da posição ${slot.index}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemove?.(slot.index);
                    }}
                  >
                    ×
                  </button>
                ) : null}

                {pickerFor === slot.index ? (
                  <div
                    className="hotbar-picker"
                    role="dialog"
                    aria-label={`Atalhos disponíveis para a posição ${slot.index}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {choices.length === 0 ? (
                      <p className="hotbar-picker-empty">Nenhum atalho disponível agora.</p>
                    ) : (
                      choices.map((choice) => (
                        <button
                          key={choice.id}
                          type="button"
                          className="hotbar-picker-item"
                          onClick={() => {
                            onAssign?.(slot.index, {
                              kind: 'attack',
                              sourceId: choice.sourceId,
                            });
                            setPickerFor(null);
                          }}
                        >
                          <span className="hotbar-picker-name">{choice.label}</span>
                          <span className="hotbar-picker-detail">{choice.detail}</span>
                        </button>
                      ))
                    )}
                    <button
                      type="button"
                      className="hotbar-picker-close"
                      onClick={() => setPickerFor(null)}
                    >
                      fechar
                    </button>
                  </div>
                ) : null}
              </div>
            );
          }

          // ---------------------------------------------------------------
          // ATALHO SALVO SEM USO AGORA: posição preservada, sem execução.
          // ---------------------------------------------------------------
          if (slot.state === 'unavailable' || slot.state === 'missing') {
            const missing = slot.state === 'missing';
            return (
              <span
                key={`hotbar-inert-${slot.index}`}
                className={`hotbar-slot is-${slot.state}`}
                data-slot={slot.index}
                title={
                  missing
                    ? 'Este atalho aponta para um ataque que não existe mais — remova ou substitua na personalização'
                    : `${slot.label ?? 'Atalho'} — indisponível: equipe a arma novamente`
                }
              >
                <span className="hotbar-slot-key" aria-hidden="true">
                  {slot.index}
                </span>
                <span className="hotbar-slot-flag">
                  {missing ? 'ausente' : 'sem arma'}
                </span>
              </span>
            );
          }

          // ---------------------------------------------------------------
          // SLOT VAZIO: posição reservada da grade, sem conteúdo inventado.
          // ---------------------------------------------------------------
          if (!entry) {
            return (
              <span
                key={`hotbar-empty-${slot.index}`}
                className="hotbar-slot is-empty"
                data-slot={slot.index}
                aria-hidden="true"
              />
            );
          }

          // RECURSO ESGOTADO (6.6M.6.3.1.2): fica visível porém escurecido,
          // indicando "fora de uso". Continua NORMAL quando ainda há Ação — ou
          // quando a Attack Action em andamento ainda permite o próximo golpe.
          const spent = hotbarSlotSpent(slot, economy);

          return (
            <button
              key={`hotbar-slot-${slot.index}`}
              type="button"
              className={[
                entry.kind === 'attack' ? 'hotbar-slot is-attack' : 'hotbar-slot',
                spent ? 'is-spent' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-slot={slot.index}
              aria-pressed={selectedId === entry.id}
              aria-label={`${slot.index}. ${entry.label} — ${entry.detail} (${COST_LABEL[entry.cost]})${
                spent ? ' — recurso do turno já usado' : ''
              }`}
              title={entry.disabledReason ?? (spent ? `Sem ${COST_LABEL[entry.cost]} disponível neste turno` : undefined)}
              disabled={busy || spent || Boolean(entry.disabledReason)}
              onClick={() => onSelect(entry)}
            >
              <span className="hotbar-slot-key" aria-hidden="true">
                {slot.index}
              </span>
              <Icon name={entry.icon} size={18} />
              {/* Custo TÍPICO: o glifo do RECURSO (o mesmo da coluna da dock). */}
              {entry.cost !== 'other' ? (
                <span className={`hotbar-cost is-${entry.cost}`} aria-hidden="true">
                  <span className="hotbar-cost-mark" />
                </span>
              ) : null}

              {/* PREVIEW: aparece ACIMA do slot no hover e no foco, sem empurrar
                  nada (posição absoluta) e sem estado extra no React. */}
              <span className="hotbar-preview" role="tooltip">
                <span className="hotbar-preview-name">{entry.label}</span>
                <span className="hotbar-preview-detail">{entry.detail}</span>
                {entry.description ? (
                  <span className="hotbar-preview-desc">{entry.description}</span>
                ) : null}
                <span className="hotbar-preview-cost">custo: {COST_LABEL[entry.cost]}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* "Ver todas": atalhos disponíveis que ficaram FORA da grade (configuração
          salva ocupa as 48 posições). Com filtro ativo prevalece o gesto de
          limpar, que já está na linha do topo. */}
      {!editing && extraEntries.length > 0 && !filter ? (
        <details className="hotbar-all">
          <summary>ver todas ({extraEntries.length})</summary>
          <div className="hotbar-all-list">
            {extraEntries.map((entry, index) => (
              <button
                key={entry.id}
                type="button"
                className="hotbar-all-item"
                disabled={busy}
                onClick={() => onSelect(entry)}
              >
                <span className="hotbar-all-index">{index + 1}</span>
                <span className="hotbar-all-name">{entry.label}</span>
                <span className="hotbar-all-detail">{entry.detail}</span>
              </button>
            ))}
          </div>
        </details>
      ) : null}

      {/* Contador só no editor: fora dele a grade fala por si (sem cabeçalho). */}
      {editing ? (
        <span className="hotbar-edit-count" aria-hidden="true">
          {visibleCount}/{HOTBAR_SLOTS}
        </span>
      ) : null}
    </section>
  );
}
