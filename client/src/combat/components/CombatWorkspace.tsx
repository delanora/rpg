import type { ReactNode } from 'react';

interface CombatWorkspaceProps {
  /** Linha superior: título, rodada, contexto do turno e controles do Mestre. */
  header: ReactNode;
  /** Esquerda: a ordem de iniciativa do servidor. */
  initiative: ReactNode;
  /**
   * Centro tático, faixa de BAIXO: a TRAY com a operação do turno (ataque,
   * espera, Teste contra a Morte). Fica abaixo do mapa para que o grid ocupe
   * o topo e a maior superfície da tela.
   */
  action: ReactNode;
  /** Centro tático, faixa de CIMA: a cena (maior superfície do workspace). */
  scene: ReactNode;
  /** Direita: o registro do combate, em coluna própria. */
  log: ReactNode;
  /** Painéis contextuais (Concentração, Reação). Ausente = nada é desenhado. */
  context?: ReactNode;
  /** Atalhos e estado mecânico — valem para QUALQUER papel (sem admin). */
  tools?: ReactNode;
  /**
   * Administração do Mestre (dano/cura manual, ajustes de economia, NPC).
   * O jogador não recebe esta região: o React simplesmente não a monta.
   */
  masterTools?: ReactNode;
  /** Barra persistente de recursos do turno (fica sempre no rodapé). */
  resourceBar?: ReactNode;
}

/**
 * COMPOSIÇÃO do combate (6.6M.5.2): iniciativa · centro tático (ação + cena) ·
 * registro, com as faixas de ferramentas e a barra persistente embaixo.
 *
 * Este componente NÃO tem estado, efeito nem regra: ele só distribui `children`
 * nas regiões do layout. Quem orquestra continua sendo o `CombatTracker`, e
 * cada painel continua sendo o MESMO componente de antes — reorganizar a tela
 * não concede autoridade nenhuma a ninguém.
 */
export function CombatWorkspace({
  header,
  initiative,
  action,
  scene,
  log,
  context,
  tools,
  masterTools,
  resourceBar,
}: CombatWorkspaceProps) {
  return (
    <section className="combat-workspace" aria-label="Mesa de combate">
      <header className="combat-workspace-header">{header}</header>

      <div className="combat-workspace-body">
        <div className="combat-workspace-col combat-workspace-initiative">{initiative}</div>

        <div className="combat-tactical-center">
          {/* Cena PRIMEIRO: o grid domina a altura; a operação é a tray abaixo. */}
          <div className="combat-tactical-scene">{scene}</div>
          <div className="combat-tactical-action">
            {context ? <div className="combat-tactical-context">{context}</div> : null}
            <div className="combat-tactical-flow">{action}</div>
          </div>
        </div>

        <aside className="combat-workspace-log" aria-label="Registro do combate">
          {log}
        </aside>
      </div>

      {masterTools ? <div className="combat-workspace-master-tools">{masterTools}</div> : null}
      {tools ? <div className="combat-workspace-tools">{tools}</div> : null}
      {resourceBar ? <div className="combat-workspace-resource">{resourceBar}</div> : null}
    </section>
  );
}
