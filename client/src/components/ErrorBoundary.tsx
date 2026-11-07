import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * REDE DE SEGURANÇA DA INTERFACE (correção da "tela marrom").
 *
 * Sem uma barreira de erro, o React 19 DESMONTA a árvore inteira quando um
 * componente lança durante o render ou num efeito: o `#root` fica vazio e a
 * pessoa vê só o fundo do `body` (a tela "toda marrom"), precisando recarregar
 * a página. Isso não é específico do ciclo de morte — qualquer falha isolada
 * derrubava o app inteiro.
 *
 * A barreira NÃO esconde o problema: mostra a mensagem em PT-BR, guarda o
 * detalhe técnico (mensagem + pilha) para copiar e oferece "Tentar novamente"
 * (remonta a árvore com o estado atual) e "Recarregar a página". Nada aqui
 * mascara erro de regra: o servidor continua sendo a fonte de verdade e nenhuma
 * escrita é refeita por causa de um retry de render.
 */
interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // O detalhe vai para o console E para a tela: é o que permite identificar a
    // causa real sem precisar reproduzir o fluxo com o DevTools aberto.
    console.error('[interface] erro não tratado na renderização:', error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  private retry = (): void => {
    this.setState({ error: null, componentStack: null });
  };

  private reload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;

    const details = [error.message, error.stack, componentStack].filter(Boolean).join('\n\n');

    return (
      <main className="app-main app-main-wide">
        <section className="splash" role="alert" aria-label="Falha na interface">
          <p>
            <strong>Algo quebrou nesta tela.</strong>
          </p>
          <p>
            A ficha continua salva no servidor — nada foi perdido. Tente remontar a tela;
            se o problema continuar, recarregue a página.
          </p>
          <p>
            <button type="button" className="btn btn-primary" onClick={this.retry}>
              Tentar novamente
            </button>{' '}
            <button type="button" className="btn" onClick={this.reload}>
              Recarregar a página
            </button>{' '}
            <button
              type="button"
              className="btn"
              onClick={() => {
                void navigator.clipboard?.writeText(details).catch(() => undefined);
              }}
            >
              Copiar detalhes
            </button>
          </p>
          <details>
            <summary className="field-hint">Detalhe técnico</summary>
            <pre className="field-hint" style={{ whiteSpace: 'pre-wrap', textAlign: 'left' }}>
              {details}
            </pre>
          </details>
        </section>
      </main>
    );
  }
}
