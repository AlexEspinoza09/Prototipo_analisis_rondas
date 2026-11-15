import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { api } from '../api/client';
import type { Summary } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ROLE_LABELS } from '../lib/labels';
import { Icon, type IconName } from './Icon';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  { title: 'General', items: [{ to: '/panel', label: 'Panel general', icon: 'dashboard' }] },
  {
    title: 'Operación',
    items: [
      { to: '/mapa', label: 'Mapa de rondas', icon: 'map' },
      { to: '/rondas', label: 'Registro de rondas', icon: 'list' },
      { to: '/anomalias', label: 'Anomalías', icon: 'alert' },
    ],
  },
  {
    title: 'Administración',
    items: [
      { to: '/admin/checkpoints', label: 'Checkpoints', icon: 'pin' },
      { to: '/admin/rutas', label: 'Rutas', icon: 'route' },
      { to: '/admin/personal', label: 'Personal', icon: 'users' },
    ],
  },
];

function initials(name: string | undefined): string {
  if (!name) return '··';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

export function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // Shared with the dashboard page (same query key), so it costs no extra request there.
  const summary = useQuery({
    queryKey: ['summary'],
    queryFn: () => api<Summary>('/dashboard/summary?days=14'),
    refetchInterval: 60_000,
  });
  const openAnomalies = summary.data?.totals.open_anomalies ?? 0;

  useEffect(() => setMenuOpen(false), [location.pathname]);

  const current = NAV_GROUPS.flatMap((group) =>
    group.items.map((item) => ({ ...item, group: group.title })),
  ).find((item) => location.pathname.startsWith(item.to));

  const today = new Date().toLocaleDateString('es-EC', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="flex min-h-screen">
      {menuOpen && (
        <div className="fixed inset-0 z-30 bg-navy/50 lg:hidden" onClick={() => setMenuOpen(false)} />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col bg-navy text-slate-300 transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-white">
            <Icon name="shield" size={20} />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-white">Monitoreo de Rondas</div>
            <div className="text-[11px] text-slate-400">Seguridad inteligente</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Navegación principal">
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="mb-5">
              <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {group.title}
              </div>
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                        isActive
                          ? 'bg-navy-3 font-medium text-white'
                          : 'text-slate-300 hover:bg-navy-2 hover:text-white'
                      }`
                    }
                  >
                    <Icon name={item.icon} />
                    <span className="flex-1">{item.label}</span>
                    {item.to === '/anomalias' && openAnomalies > 0 && (
                      <span
                        className="rounded-full bg-critical px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white"
                        title={`${openAnomalies} anomalías pendientes de revisión`}
                      >
                        {openAnomalies > 99 ? '99+' : openAnomalies}
                      </span>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-3 px-2 py-1.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-3 text-xs font-semibold text-white">
              {initials(user?.full_name)}
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-sm text-white">{user?.full_name}</div>
              <div className="text-[11px] text-slate-400">{user ? ROLE_LABELS[user.role] : ''}</div>
            </div>
            <button
              onClick={logout}
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
              className="rounded-md p-2 text-slate-400 hover:bg-navy-2 hover:text-white"
            >
              <Icon name="logout" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-grid bg-surface px-4 lg:px-8">
          <button
            className="rounded-md p-2 text-ink-2 hover:bg-plane lg:hidden"
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menú"
          >
            <Icon name="menu" />
          </button>
          <nav className="flex items-center gap-1.5 text-sm" aria-label="Ubicación">
            <span className="text-muted">{current?.group ?? 'Inicio'}</span>
            {current && (
              <>
                <Icon name="chevronRight" size={14} className="text-muted" />
                <span className="font-medium text-ink">{current.label}</span>
              </>
            )}
          </nav>
          <span className="ml-auto hidden text-xs text-muted first-letter:uppercase sm:block">{today}</span>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 lg:px-8">
          <div className="mx-auto max-w-[1400px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
