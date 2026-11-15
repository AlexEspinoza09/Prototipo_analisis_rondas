import { Navigate, Route, Routes } from 'react-router-dom';

import { useAuth } from './auth/AuthContext';
import { Icon } from './components/Icon';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { AnomaliesPage } from './pages/AnomaliesPage';
import { KpisPage } from './pages/KpisPage';
import { LoginPage } from './pages/LoginPage';
import { MapPage } from './pages/MapPage';
import { RondasPage } from './pages/RondasPage';
import { CheckpointsPage } from './pages/admin/CheckpointsPage';
import { GuardsPage } from './pages/admin/GuardsPage';
import { RoutesPage } from './pages/admin/RoutesPage';

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner label="Cargando el panel…" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'guard') {
    return (
      <div className="flex h-screen items-center justify-center px-6">
        <div className="card card-body max-w-md text-center">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-primary-soft text-primary">
            <Icon name="shield" size={22} />
          </div>
          <h1 className="text-base font-semibold">Acceso restringido</h1>
          <p className="mb-5 mt-2 text-sm text-ink-2">
            El panel de supervisión está disponible únicamente para supervisores y
            administradores. El personal de guardia debe utilizar la aplicación móvil.
          </p>
          <button onClick={logout} className="btn-primary">
            Cerrar sesión
          </button>
        </div>
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
        <Route index element={<Navigate to="/panel" replace />} />
        <Route path="panel" element={<KpisPage />} />
        <Route path="mapa" element={<MapPage />} />
        <Route path="rondas" element={<RondasPage />} />
        <Route path="anomalias" element={<AnomaliesPage />} />
        <Route path="kpis" element={<Navigate to="/panel" replace />} />
        <Route path="admin/checkpoints" element={<CheckpointsPage />} />
        <Route path="admin/rutas" element={<RoutesPage />} />
        <Route path="admin/personal" element={<GuardsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
