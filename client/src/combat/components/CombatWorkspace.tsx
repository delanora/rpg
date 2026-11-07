import { Fragment, isValidElement, type ReactNode } from 'react';

/**
 * Algum conteúdo REALMENTE desenha neste nó? (6.6M.6.2.2)
 *
 * A tray operacional é sempre passada pelo orquestrador (um fragmento com
 * condicionais dentro), então `node != null` não distingue "tem painel" de
 * "todo mundo devolveu null". Sem essa distinção a linha `auto` do centro
 * tático continuava existindo — com o `gap` do grid — mesmo sem nada dentro.
 *
 * A checagem é ESTRUTURAL e não olha regra nenhuma: nulos/booleanos/vazios não
 * desenham; fragmentos são abertos para inspecionar os filhos (é o formato que
 * o `CombatTracker` usa). Um elemento conta como conteúdo — ele é montado e
 * quem decide desenhar ou não é ele mesmo.
 */
export function hasRenderableContent(node: ReactNode): boolean {
  if (node === null || node === undefined || typeof node === 'boolean') return false;
  if (typeof node === 'string') return node.trim().length > 0;
  if (typeof node === 'number') return true;
  if (Array.isArray(node)) return node.some(hasRenderableContent);
  if (isValidElement(node)) {
    if (node.type === Fragment) {
      return hasRenderableContent((node.props as { children?: ReactNode }).children);
    }
    return true;
  }
  return true;
}

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
  /**
   * Dock do jogador (6.6M.6.1): retrato, recursos, Hotbar, utilitários e
   * deslocamento, logo abaixo do corpo e ACIMA da barra persistente. É só uma
   * região de layout — a dock não conhece regra nenhuma.
   */
  dock?: ReactNode;
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
  dock,
  context,
  tools,
  masterTools,
  resourceBar,
}: CombatWorkspaceProps) {
  return (
    <section
      // A dock só existe para o jogador: a classe marca a superfície para ela
      // reservar a faixa dos botões flutuantes sem tocar na tela do Mestre.
      className={dock ? 'combat-workspace has-player-dock' : 'combat-workspace'}
      aria-label="Mesa de combate"
    >
      <header className="combat-workspace-header">{header}</header>

      <div className="combat-workspace-body">
        <div className="combat-workspace-col combat-workspace-initiative">{initiative}</div>

        <div className="combat-tactical-center">
          {/* Cena PRIMEIRO: o grid domina a altura; a operação é a tray abaixo. */}
          <div className="combat-tactical-scene">{scene}</div>
          {/* A tray só existe com conteúdo operacional de verdade (ataque
              escolhido, Reação, Concentração, Teste contra a Morte…). Sem
              conteúdo, a linha `auto` e o `gap` do centro NÃO são reservados e
              a cena herda a altura — nada de faixa vazia sob o mapa. Quando
              existe, o MESMO `action`/`context` de sempre é montado. */}
          {hasRenderableContent(action) || hasRenderableContent(context) ? (
            <div className="combat-tactical-action">
              {hasRenderableContent(context) ? (
                <div className="combat-tactical-context">{context}</div>
              ) : null}
              <div className="combat-tactical-flow">{action}</div>
            </div>
          ) : null}
        </div>

        <aside className="combat-workspace-log" aria-label="Registro do combate">
          {log}
        </aside>
      </div>

      {dock ? <div className="combat-workspace-dock">{dock}</div> : null}
      {masterTools ? <div className="combat-workspace-master-tools">{masterTools}</div> : null}
      {tools ? <div className="combat-workspace-tools">{tools}</div> : null}
      {resourceBar ? <div className="combat-workspace-resource">{resourceBar}</div> : null}
    </section>
  );
}
