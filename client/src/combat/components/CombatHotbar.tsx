import { Icon } from '../../components/Icon';
import {
  HOTBAR_SLOTS,
  buildHotbarSlots,
  hotbarFilterLabel,
  type CombatHotbarEntry,
  type HotbarCost,
  type HotbarFilter,
} from '../hotbar';

/** Letra do custo no canto do slot: A = Ação, B = Ação Bônus, R = Reação. */
const COST_SIGN: Record<HotbarCost, string> = {
  action: 'A',
  'bonus-action': 'B',
  reaction: 'R',
  other: '',
};

const COST_LABEL: Record<HotbarCost, string> = {
  action: 'Ação',
  'bonus-action': 'Ação Bônus',
  reaction: 'Reação',
  other: 'custo definido pelo servidor',
};

interface CombatHotbarProps {
  /** Entradas JÁ filtradas pelo chamador (`filterHotbarEntries`). */
  entries: CombatHotbarEntry[];
  busy: boolean;
  /** Entrada escolhida (marca o slot). Só visual: quem envia é o fluxo existente. */
  selectedId?: string | null;
  /**
   * Filtro ativo (navegação pelos glifos da dock). Só serve para o estado vazio
   * e para o rótulo: a lista chega pronta, e nada aqui decide custo ou regra.
   */
  filter?: HotbarFilter | null;
  /** Volta à lista completa (mesmo gesto de clicar de novo no glifo). */
  onClearFilter?: () => void;
  onSelect: (entry: CombatHotbarEntry) => void;
}

/**
 * HOTBAR DE COMBATE — GRADE DE 32 SLOTS (2×16).
 *
 * Esta é uma SUPERFÍCIE DE ACESSO: mostra o que o personagem já possui e
 * encaminha o clique para o fluxo existente (painel de ataque, alvo, modo de
 * rolagem, munição, modificadores, envio ao servidor). O componente não tem
 * estado, não calcula regra, não cobra economia e não resolve nada sozinho.
 *
 * A grade é FIXA em 32 posições indexadas (`buildHotbarSlots`): o que existe
 * ocupa as primeiras posições e o resto fica visivelmente vazio. Nada é
 * inventado para preencher slot, e o excedente continua em "ver todas".
 *
 * Sem cabeçalho de título: o número discreto do rodapé (preenchidos/32) é a
 * única indicação de contexto, e os slots são os protagonistas.
 */
export function CombatHotbar({
  entries,
  busy,
  selectedId = null,
  filter = null,
  onClearFilter,
  onSelect,
}: CombatHotbarProps) {
  // Sem filtro e sem opção real, a faixa inteira não é montada: recuperar
  // espaço é a razão de existir da Hotbar. COM filtro ela permanece montada —
  // "esta categoria está vazia" é resposta honesta, e trocar/limpar o filtro
  // continua a um clique.
  if (entries.length === 0 && !filter) return null;

  const slots = buildHotbarSlots(entries);
  const filled = slots.filter((slot) => slot.entry !== null).length;
  const emptyNote =
    filter && entries.length === 0
      ? `Nenhuma opção de ${hotbarFilterLabel(filter)} nesta Hotbar`
      : null;

  return (
    <section className="combat-hotbar" aria-label="Ações rápidas do turno">
      {/* Categoria sem entradas: frase curta na linha discreta do topo, a grade
          completa de slots vazios e "Ver todas". Nenhum slot fictício. */}
      {emptyNote ? (
        <span className="hotbar-note" role="status">
          {emptyNote}
        </span>
      ) : null}

      <div className="hotbar-slots" role="toolbar" aria-label="Hotbar de combate">
        {slots.map((slot) => {
          const entry = slot.entry;
          // SLOT VAZIO: posição reservada da grade, sem conteúdo inventado.
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

          return (
            <button
              key={entry.id}
              type="button"
              className={entry.kind === 'attack' ? 'hotbar-slot is-attack' : 'hotbar-slot'}
              data-slot={slot.index}
              aria-pressed={selectedId === entry.id}
              aria-label={`${slot.index}. ${entry.label} — ${entry.detail} (${COST_LABEL[entry.cost]})`}
              disabled={busy}
              onClick={() => onSelect(entry)}
            >
              <span className="hotbar-slot-key" aria-hidden="true">
                {slot.index}
              </span>
              <Icon name={entry.icon} size={18} />
              {COST_SIGN[entry.cost] ? (
                <span className={`hotbar-cost is-${entry.cost}`} aria-hidden="true">
                  {COST_SIGN[entry.cost]}
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

      {filter ? (
        // Com filtro ativo o contador dá lugar ao gesto de limpar (o mesmo do
        // glifo da dock): o usuário nunca fica preso numa categoria vazia.
        <button type="button" className="hotbar-clear-filter" onClick={onClearFilter}>
          Ver todas
        </button>
      ) : entries.length > HOTBAR_SLOTS ? (
        <details className="hotbar-all">
          <summary>ver todas ({entries.length})</summary>
          <div className="hotbar-all-list">
            {entries.map((entry, index) => (
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
      ) : (
        // Contador discreto: quantas posições da grade estão PREENCHIDAS. Nunca
        // um botão que não faz nada.
        <span className="hotbar-all-count">
          {filled}/{HOTBAR_SLOTS}
        </span>
      )}
    </section>
  );
}
