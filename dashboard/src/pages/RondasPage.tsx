import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { SessionListItem, SessionStatus, User } from '../api/types';
import { Icon } from '../components/Icon';
import { Badge, PageHeader, TableMessage, type Tone } from '../components/ui';
import { STATUS_LABELS, formatDateTime } from '../lib/labels';

// Status palette (validated reference palette): icon + label always accompany
// the color, so state is never encoded by color alone.
const STATUS_GOOD = '#0ca30c';
const STATUS_CRITICAL = '#d03b3b';

const STATUS_TONE: Record<SessionStatus, Tone> = {
  in_progress: 'info',
  completed: 'good',
  abandoned: 'critical',
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
  if (total === 0) return <span className="text-xs text-muted">Sin escaneos</span>;
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

  const all = sessions.data ?? [];
  const rows = all.filter(
    (session) =>
      (statusFilter === '' || session.status === statusFilter) &&
      (guardFilter === '' || session.guard_id === guardFilter),
  );
  const filtered = statusFilter !== '' || guardFilter !== '';

  return (
    <div>
      <PageHeader
        title="Registro de rondas"
        description="Historial de las rondas ejecutadas, con su duración y el resultado de los escaneos."
      />

      <div className="card">
        <div className="card-header">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="field-label" htmlFor="filter-status">
                Estado
              </label>
              <select
                id="filter-status"
                className="input w-48"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as SessionStatus | '')}
              >
                <option value="">Todos</option>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="filter-guard">
                Guardia
              </label>
              <select
                id="filter-guard"
                className="input w-56"
                value={guardFilter}
                onChange={(e) => setGuardFilter(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">Todos</option>
                {guards.data?.map((guard) => (
                  <option key={guard.id} value={guard.id}>
                    {guard.full_name}
                  </option>
                ))}
              </select>
            </div>
            {filtered && (
              <button
                className="btn-secondary"
                onClick={() => {
                  setStatusFilter('');
                  setGuardFilter('');
                }}
              >
                Limpiar filtros
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>N.º</th>
                <th>Guardia</th>
                <th>Ruta</th>
                <th>Inicio</th>
                <th>Duración</th>
                <th>Escaneos</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((session) => (
                <tr key={session.id} className="row-hover">
                  <td className="tabular-nums text-ink-2">{session.id}</td>
                  <td className="font-medium">{session.guard_name}</td>
                  <td>{session.route_name}</td>
                  <td className="whitespace-nowrap">{formatDateTime(session.started_at)}</td>
                  <td className="whitespace-nowrap tabular-nums">{durationLabel(session)}</td>
                  <td>
                    <ScanBar valid={session.scans_valid} invalid={session.scans_invalid} />
                  </td>
                  <td>
                    <Badge tone={STATUS_TONE[session.status]}>{STATUS_LABELS[session.status]}</Badge>
                  </td>
                  <td className="text-right">
                    <Link to={`/mapa?sesion=${session.id}`} className="link-action">
                      <Icon name="map" size={14} />
                      Ver en el mapa
                    </Link>
                  </td>
                </tr>
              ))}
              {sessions.isLoading && <TableMessage colSpan={8}>Cargando rondas…</TableMessage>}
              {rows.length === 0 && !sessions.isLoading && (
                <TableMessage colSpan={8}>
                  {filtered
                    ? 'Ninguna ronda coincide con los filtros seleccionados.'
                    : 'Todavía no se registran rondas.'}
                </TableMessage>
              )}
            </tbody>
          </table>
        </div>
        {!sessions.isLoading && (
          <div className="table-footer">
            {filtered
              ? `${rows.length} de ${all.length} rondas`
              : `${all.length} rondas registradas`}
          </div>
        )}
      </div>
    </div>
  );
}
