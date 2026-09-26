import { AuthProvider, useAuth } from './auth';
import { AuthPage } from './components/AuthPage';
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
  return (
    <AuthProvider>
      <LightboxProvider>
        <Shell />
      </LightboxProvider>
    </AuthProvider>
  );
}
