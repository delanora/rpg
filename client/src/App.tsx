import { AuthProvider, useAuth } from './auth';
import { AuthPage } from './components/AuthPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LightboxProvider } from './components/Lightbox';
import { MasterPanel } from './pages/MasterPanel';
import { SheetPage } from './pages/SheetPage';

function Shell() {
  const { user, loading } = useAuth();

  if (loading) return <p className="splash">Abrindo o grimório...</p>;
  if (!user) return <AuthPage />;

  // O mestre tem o painel exclusivo; o jogador, a própria ficha.
  return user.role === 'MASTER' ? <MasterPanel user={user} /> : <SheetPage user={user} />;
}

export function App() {
  // A barreira fica na RAIZ: qualquer falha de renderização/efeito deixa de
  // esvaziar o `#root` (tela vazia no fundo do tema) e passa a ser mostrada na
  // própria página, com o detalhe técnico e um caminho de volta sem reload.
  return (
    <ErrorBoundary>
      <AuthProvider>
        <LightboxProvider>
          <Shell />
        </LightboxProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
