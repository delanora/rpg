import { Icon } from '../../components/Icon';
import type { CombatRollMode } from '../gridTargeting';

/**
 * MENU DE MODO DE ROLAGEM DO ATAQUE (6.6M.6.4.3).
 *
 * Aparece ABAIXO do token do alvo escolhido (ou acima, se não couber) logo
 * depois do clique que escolhe o alvo. É um atalho de APRESENTAÇÃO para o MESMO
 * envio do botão "Rolar ataque": escolher o modo define `advantage`/
 * `disadvantage` no payload existente e dispara o resolver do servidor.
 *
 * Nenhuma regra mora aqui — sem alcance, sem cobertura, sem economia. O
 * componente recebe a posição já em PIXEL DE TELA (fora da camada de pan/zoom),
 * então o menu não escala com o zoom nem é recortado pelo plano da cena.
 */
const MODES: { key: CombatRollMode; label: string; icon: 'die' | 'sun' | 'moon'; title: string }[] = [
  { key: 'normal', label: 'Normal', icon: 'die', title: 'Uma rolagem de d20.' },
  {
    key: 'advantage',
    label: 'Vantagem',
    icon: 'sun',
    title: 'Rola 2d20 e mantém o maior. Habilita o Ataque Furtivo do Ladino.',
  },
  {
    key: 'disadvantage',
    label: 'Desvantagem',
    icon: 'moon',
    title: 'Rola 2d20 e mantém o menor. Impede o Ataque Furtivo do Ladino.',
  },
];

export function GridRollModePicker({
  left,
  top,
  ready,
  busy,
  selected = null,
  onChoose,
}: {
  /** Centro do menu, em px de tela (já ajustado às bordas pelo grid). */
  left: number;
  top: number;
  /** A execução está liberada agora? Falso só desabilita — nada é inferido. */
  ready: boolean;
  busy: boolean;
  /** Modo JÁ escolhido: reabrir o menu serve para TROCAR (destaque no atual). */
  selected?: CombatRollMode | null;
  onChoose: (mode: CombatRollMode) => void;
}) {
  return (
    <div
      className="grid-roll-menu"
      role="group"
      aria-label="Modo de rolagem do ataque"
      style={{ left: `${left}px`, top: `${top}px` }}
      // O clique aqui NÃO é gesto do mapa: sem isso ele trocaria a seleção de
      // célula, fecharia o menu do fundo ou iniciaria pan.
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <span className="grid-roll-menu-title">Modo de rolagem</span>
      <div className="grid-roll-menu-options">
        {MODES.map((mode) => (
          <button
            key={mode.key}
            type="button"
            className={
              selected === mode.key ? 'grid-roll-menu-btn is-active' : 'grid-roll-menu-btn'
            }
            title={mode.title}
            aria-pressed={selected === mode.key}
            disabled={busy || !ready}
            onClick={() => onChoose(mode.key)}
          >
            <Icon name={mode.icon} size={13} /> {mode.label}
          </button>
        ))}
      </div>
    </div>
  );
}
