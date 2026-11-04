import { DeathCounter } from '../../death/DeathCounter';
import { Icon } from '../../components/Icon';
import type { DeathState } from '../../types';

interface DeathSavePanelProps {
  name: string;
  death: DeathState;
}

/**
 * 6.6I — PAINEL CENTRAL de quem está no ciclo de morte: SÓ ESTADO.
 *
 * O botão de rolagem saiu daqui. A interação ("Rolar Salvaguarda") vive no card
 * do REGISTRO lateral, junto com o resultado e o histórico — a área central
 * mantém apenas o que precisa continuar visível sem abrir o log: 0 PV, os
 * contadores de Sucessos/Falhas e o estado (estabilizado/morto/decisão).
 *
 * Nada aqui muta nada: os valores vêm do DTO do combate e a elegibilidade é do
 * servidor (o card só aparece quando a rolagem é devida).
 */
export function DeathSavePanel({ name, death }: DeathSavePanelProps) {
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
        <p className="death-turn-hint">
          A rolagem fica no Registro, à direita. 10 ou mais é um sucesso; três sucessos
          estabilizam e três falhas colocam o destino nas mãos do Mestre.
        </p>
      ) : null}
    </section>
  );
}
