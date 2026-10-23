import { DeathCounter } from '../../death/DeathCounter';
import { Icon } from '../../components/Icon';
import type { DeathState } from '../../types';

interface DeathSavePanelProps {
  name: string;
  death: DeathState;
  /** O servidor libera a rolagem agora? (próprio turno, não estabilizado...) */
  rollAvailable: boolean;
  /** Motivo de indisponibilidade vindo do servidor (quando houver). */
  rollReason?: string;
  /** Há botão de rolagem para ESTE espectador (jogador dono ou Mestre da criatura). */
  canRoll: boolean;
  /** Texto do botão (público para jogador; privado para o Mestre). */
  rollLabel: string;
  onRoll?: () => void;
  busy?: boolean;
}

/**
 * PAINEL CENTRAL no turno de um combatente em Testes contra a Morte. Substitui o
 * fluxo normal (ataque/alvo/ações) por um bloco dramático e compacto: o
 * contador corações-caveiras e UM botão de rolagem. O sistema NUNCA rola
 * sozinho — o jogador escolhe o momento (server-authoritative); o Mestre rola o
 * Teste PRIVADO de criaturas.
 *
 * Só apresentação: os valores e a elegibilidade vêm do DTO do combate.
 */
export function DeathSavePanel({
  name,
  death,
  rollAvailable,
  rollReason,
  canRoll,
  rollLabel,
  onRoll,
  busy = false,
}: DeathSavePanelProps) {
  return (
    <section className="death-turn-panel" aria-label="Teste contra a Morte">
      <p className="death-turn-eyebrow">
        <Icon name="skull" size={14} /> Teste contra a Morte
      </p>
      <p className="death-turn-name">{name}</p>

      {death.dead ? (
        <p className="death-turn-note dead">
          <Icon name="skull" size={14} /> MORTO — o Mestre confirmou o desfecho.
        </p>
      ) : null}

      {death.pending ? (
        <p className="death-turn-note pending">
          <Icon name="crown" size={14} /> O destino está nas mãos do Mestre:{' '}
          <strong>aguardando a resolução.</strong>
        </p>
      ) : null}

      <DeathCounter successes={death.successes} failures={death.failures} showNumbers />

      {death.stabilized ? (
        <p className="death-turn-note stabilized">
          <Icon name="heart" size={14} /> ESTABILIZADO — sem novos Testes contra a Morte.
          Continua a 0 PV e Inconsciente até receber cura.
        </p>
      ) : null}

      {!death.dead && !death.pending && !death.stabilized ? (
        <>
          <p className="death-turn-hint">
            Role 1d20. 10 ou mais é um sucesso. Três sucessos estabilizam; três falhas
            colocam o destino nas mãos do Mestre.
          </p>
          {canRoll ? (
            <button
              type="button"
              className="death-turn-roll"
              disabled={busy || !rollAvailable}
              onClick={onRoll}
            >
              <Icon name="die" size={16} /> {rollLabel}
            </button>
          ) : (
            <p className="death-turn-hint">
              {rollReason || 'Aguardando o turno deste combatente.'}
            </p>
          )}
          {canRoll && !rollAvailable && rollReason ? (
            <p className="death-turn-hint">{rollReason}</p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
