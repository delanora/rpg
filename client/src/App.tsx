import { AuthProvider, useAuth } from './auth';
import { AuthPage } from './components/AuthPage';
import { SheetPage } from './pages/SheetPage';

function Shell() {
  const { user, loading } = useAuth();

  if (loading) return <p className="splash">Abrindo o grimório...</p>;
  if (!user) return <AuthPage />;

  return <SheetPage user={user} />;
}

export function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
