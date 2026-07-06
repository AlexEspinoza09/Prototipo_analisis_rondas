import { Navigate, Route, Routes } from 'react-router-dom';

import { useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { AnomaliesPage } from './pages/AnomaliesPage';
import { KpisPage } from './pages/KpisPage';
import { LoginPage } from './pages/LoginPage';
import { MapPage } from './pages/MapPage';
import { CheckpointsPage } from './pages/admin/CheckpointsPage';
import { GuardsPage } from './pages/admin/GuardsPage';
import { RoutesPage } from './pages/admin/RoutesPage';

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  if (loading) {
    return <div className="flex h-screen items-center justify-center text-muted">Cargando…</div>;
  }
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'guard') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <p className="text-ink-2">
          El panel es solo para supervisores y administradores. Usa la app móvil.
        </p>
        <button
          onClick={logout}
          className="rounded bg-ink px-4 py-2 text-sm text-white hover:opacity-90"
        >
          Cerrar sesión
        </button>
      </div>
    );
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<Navigate to="/mapa" replace />} />
        <Route path="mapa" element={<MapPage />} />
        <Route path="anomalias" element={<AnomaliesPage />} />
        <Route path="kpis" element={<KpisPage />} />
        <Route path="admin/checkpoints" element={<CheckpointsPage />} />
        <Route path="admin/rutas" element={<RoutesPage />} />
        <Route path="admin/personal" element={<GuardsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
