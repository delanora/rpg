import { Icon } from '../../components/Icon';
import { HOTBAR_SLOTS, type CombatHotbarEntry, type HotbarCost } from '../hotbar';

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
  entries: CombatHotbarEntry[];
  busy: boolean;
  /** Entrada escolhida (marca o slot). Só visual: quem envia é o fluxo existente. */
  selectedId?: string | null;
  onSelect: (entry: CombatHotbarEntry) => void;
}

/**
 * HOTBAR DE COMBATE — PROTÓTIPO FUNCIONAL (6.6M.6).
 *
 * Esta é uma SUPERFÍCIE DE ACESSO: mostra o que o personagem já possui e
 * encaminha o clique para o fluxo existente (painel de ataque, alvo, modo de
 * rolagem, munição, modificadores, envio ao servidor). O componente não tem
 * estado, não calcula regra, não cobra economia e não resolve nada sozinho.
 *
 * Números 1–8 são indicação visual: não há atalho global nesta fase.
 */
export function CombatHotbar({ entries, busy, selectedId = null, onSelect }: CombatHotbarProps) {
  if (entries.length === 0) {
    // Sem opção real, a faixa inteira não é montada: recuperar espaço é a razão
    // de existir da Hotbar.
    return null;
  }

  const visible = entries.slice(0, HOTBAR_SLOTS);
  const emptySlots = Math.max(0, HOTBAR_SLOTS - visible.length);

  return (
    <section className="combat-hotbar" aria-label="Ações rápidas do turno">
      <span className="hotbar-title">
        <Icon name="sword" size={12} /> Ações
      </span>

      <div className="hotbar-slots" role="toolbar" aria-label="Hotbar de combate">
        {visible.map((entry, index) => (
          <button
            key={entry.id}
            type="button"
            className={entry.kind === 'attack' ? 'hotbar-slot is-attack' : 'hotbar-slot'}
            aria-pressed={selectedId === entry.id}
            aria-label={`${index + 1}. ${entry.label} — ${entry.detail} (${COST_LABEL[entry.cost]})`}
            disabled={busy}
            onClick={() => onSelect(entry)}
          >
            <span className="hotbar-slot-key" aria-hidden="true">
              {index + 1}
            </span>
            <Icon name={entry.icon} size={20} />
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
        ))}

        {/* Slots vazios: o protótipo não permite edição manual, então eles são
            apenas a reserva visual da faixa de 8. */}
        {Array.from({ length: emptySlots }).map((_, index) => (
          <span key={`hotbar-vazio-${index}`} className="hotbar-slot is-empty" aria-hidden="true">
            +
          </span>
        ))}
      </div>

      {entries.length > HOTBAR_SLOTS ? (
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
        // Com 8 ou menos não há nada escondido: um contador, nunca um botão que
        // não faz nada.
        <span className="hotbar-all-count">
          {visible.length}/{HOTBAR_SLOTS}
        </span>
      )}
    </section>
  );
}
