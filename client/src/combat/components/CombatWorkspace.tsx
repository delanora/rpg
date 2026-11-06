import type { ReactNode } from 'react';

interface CombatWorkspaceProps {
  /** Linha superior: título, rodada, contexto do turno e controles do Mestre. */
  header: ReactNode;
  /** Esquerda: a ordem de iniciativa do servidor. */
  initiative: ReactNode;
  /** Centro: a cena tática (maior superfície do workspace). */
  scene: ReactNode;
  /** Topo da lateral direita: o registro do combate. */
  log: ReactNode;
  /** Base da lateral direita: ataque/espera/Teste contra a Morte do turno. */
  action: ReactNode;
  /** Painéis contextuais (Concentração, Reação). Ausente = nada é desenhado. */
  context?: ReactNode;
  /** Ferramentas administrativas e atalhos (recolhidos). */
  tools?: ReactNode;
  /** Barra persistente de recursos do turno (fica sempre no rodapé). */
  resourceBar?: ReactNode;
}

/**
 * COMPOSIÇÃO do combate (6.6M.5): iniciativa · grid · registro/ataque, com a
 * barra persistente embaixo.
 *
 * Este componente NÃO tem estado, efeito nem regra: ele só distribui `children`
 * nas regiões do layout. Quem orquestra continua sendo o `CombatTracker`, e
 * cada painel continua sendo o MESMO componente de antes — reorganizar a tela
 * não concede autoridade nenhuma a ninguém.
 */
export function CombatWorkspace({
  header,
  initiative,
  scene,
  log,
  action,
  context,
  tools,
  resourceBar,
}: CombatWorkspaceProps) {
  return (
    <section className="combat-workspace" aria-label="Mesa de combate">
      <header className="combat-workspace-header">{header}</header>

      <div className="combat-workspace-body">
        <div className="combat-workspace-col combat-workspace-initiative">{initiative}</div>
        <div className="combat-workspace-col combat-workspace-scene">{scene}</div>

        <aside className="combat-workspace-rail" aria-label="Registro e ações do turno">
          {context ? <div className="combat-rail-context">{context}</div> : null}
          <div className="combat-rail-log">{log}</div>
          <div className="combat-rail-action">{action}</div>
        </aside>
      </div>

      {tools ? <div className="combat-workspace-tools">{tools}</div> : null}
      {resourceBar ? <div className="combat-workspace-resource">{resourceBar}</div> : null}
    </section>
  );
}
