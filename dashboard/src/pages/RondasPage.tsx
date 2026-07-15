import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { SessionListItem, SessionStatus, User } from '../api/types';
import { STATUS_LABELS, formatDateTime } from '../lib/labels';

// Status palette (validated reference palette): icon + label always accompany
// the color, so state is never encoded by color alone.
const STATUS_GOOD = '#0ca30c';
const STATUS_CRITICAL = '#d03b3b';

const STATUS_PILL: Record<SessionStatus, { icon: string; className: string }> = {
  in_progress: { icon: '●', className: 'bg-series/10 text-series' },
  completed: { icon: '✓', className: 'bg-good/10 text-good' },
  abandoned: { icon: '✕', className: 'bg-critical/10 text-critical' },
};

function durationLabel(session: SessionListItem): string {
  const start = new Date(session.started_at).getTime();
  const end = session.ended_at ? new Date(session.ended_at).getTime() : Date.now();
  const minutes = Math.max(0, Math.round((end - start) / 60_000));
  const text =
    minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  return session.ended_at ? text : `${text} (en curso)`;
}

function ScanBar({ valid, invalid }: { valid: number; invalid: number }) {
  const total = valid + invalid;
  if (total === 0) return <span className="text-sm text-muted">Sin escaneos</span>;
  return (
    <div
      className="flex items-center gap-2"
      title={`${valid} válidos, ${invalid} inválidos`}
    >
      {/* Proportion bar: thin mark, rounded data-ends, 2px surface gap between fills */}
      <div className="flex h-1.5 w-24 gap-0.5" role="img" aria-label={`${valid} de ${total} escaneos válidos`}>
        {valid > 0 && (
          <div
            className="rounded-full"
            style={{ backgroundColor: STATUS_GOOD, flexGrow: valid }}
          />
        )}
        {invalid > 0 && (
          <div
            className="rounded-full"
            style={{ backgroundColor: STATUS_CRITICAL, flexGrow: invalid }}
          />
        )}
      </div>
      {/* Counts as visible direct labels in text ink (relief rule) */}
      <span className="whitespace-nowrap text-xs tabular-nums text-ink-2">
        <span style={{ color: STATUS_GOOD }}>✓</span> {valid} ·{' '}
        <span style={{ color: STATUS_CRITICAL }}>✕</span> {invalid}
      </span>
    </div>
  );
}

export function RondasPage() {
  const [statusFilter, setStatusFilter] = useState<SessionStatus | ''>('');
  const [guardFilter, setGuardFilter] = useState<number | ''>('');

  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api<SessionListItem[]>('/sessions?limit=200'),
  });
  const guards = useQuery({
    queryKey: ['users', 'guard'],
    queryFn: () => api<User[]>('/users?role=guard'),
  });

  const rows = (sessions.data ?? []).filter(
    (session) =>
      (statusFilter === '' || session.status === statusFilter) &&
      (guardFilter === '' || session.guard_id === guardFilter),
  );

  const selectClass = 'rounded border border-grid bg-surface px-2 py-1.5 text-sm';

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Registros de rondas</h1>
        <select
          className={selectClass}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as SessionStatus | '')}
        >
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          className={selectClass}
          value={guardFilter}
          onChange={(e) => setGuardFilter(e.target.value ? Number(e.target.value) : '')}
        >
          <option value="">Todos los guardias</option>
          {guards.data?.map((guard) => (
            <option key={guard.id} value={guard.id}>
              {guard.full_name}
            </option>
          ))}
        </select>
        {sessions.isLoading && <span className="text-sm text-muted">Cargando…</span>}
      </div>

      <div className="overflow-x-auto rounded-lg border border-grid bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-grid text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Guardia</th>
              <th className="px-4 py-3">Ruta</th>
              <th className="px-4 py-3">Inicio</th>
              <th className="px-4 py-3">Duración</th>
              <th className="px-4 py-3">Escaneos</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((session) => {
              const pill = STATUS_PILL[session.status];
              return (
                <tr key={session.id} className="border-b border-grid/60 last:border-0 hover:bg-plane">
                  <td className="px-4 py-2.5 tabular-nums text-ink-2">{session.id}</td>
                  <td className="px-4 py-2.5">{session.guard_name}</td>
                  <td className="px-4 py-2.5">{session.route_name}</td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    {formatDateTime(session.started_at)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
                    {durationLabel(session)}
                  </td>
                  <td className="px-4 py-2.5">
                    <ScanBar valid={session.scans_valid} invalid={session.scans_invalid} />
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${pill.className}`}
                    >
                      <span aria-hidden>{pill.icon}</span>
                      {STATUS_LABELS[session.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link
                      to={`/mapa?sesion=${session.id}`}
                      className="text-xs text-series hover:underline"
                    >
                      Ver en mapa
                    </Link>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && !sessions.isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted">
                  No hay rondas con estos filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
