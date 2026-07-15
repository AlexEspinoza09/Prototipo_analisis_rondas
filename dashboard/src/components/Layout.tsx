import { NavLink, Outlet } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded px-3 py-2 text-sm ${
    isActive ? 'bg-series text-white' : 'text-ink-2 hover:bg-grid/60'
  }`;

export function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-grid bg-surface p-4">
        <div className="mb-6">
          <div className="text-lg font-semibold">Protemaxi</div>
          <div className="text-xs text-muted">Monitoreo de rondas</div>
        </div>
        <nav className="flex flex-col gap-1">
          <NavLink to="/mapa" className={linkClass}>
            Mapa de rondas
          </NavLink>
          <NavLink to="/rondas" className={linkClass}>
            Rondas
          </NavLink>
          <NavLink to="/anomalias" className={linkClass}>
            Anomalías
          </NavLink>
          <NavLink to="/kpis" className={linkClass}>
            KPIs
          </NavLink>
          <div className="mt-4 px-3 text-xs font-semibold uppercase tracking-wide text-muted">
            Administración
          </div>
          <NavLink to="/admin/checkpoints" className={linkClass}>
            Checkpoints
          </NavLink>
          <NavLink to="/admin/rutas" className={linkClass}>
            Rutas
          </NavLink>
          <NavLink to="/admin/personal" className={linkClass}>
            Personal
          </NavLink>
        </nav>
        <div className="mt-auto border-t border-grid pt-3">
          <div className="mb-2 truncate text-sm text-ink-2">{user?.full_name}</div>
          <button onClick={logout} className="text-sm text-critical hover:underline">
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
