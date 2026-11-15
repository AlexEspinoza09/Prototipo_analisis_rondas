import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { Anomaly, AnomalyType, Severity, User } from '../api/types';
import { Icon } from '../components/Icon';
import { Badge, PageHeader, TableMessage } from '../components/ui';
import {
  ANOMALY_LABELS,
  DETAIL_LABELS,
  JUMP_KIND_LABELS,
  PATROL_MODE_LABELS,
  SEVERITY_LABELS,
  SEVERITY_TONE,
  formatDateTime,
  formatDateTimeSeconds,
} from '../lib/labels';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
// Lists whose order is the evidence itself (shown as a sequence).
const ORDERED_LIST_KEYS = new Set(['expected_order', 'actual_order']);

const label = (key: string) => DETAIL_LABELS[key] ?? key;

function formatScalar(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'number') return value.toLocaleString('es-EC', { maximumFractionDigits: 3 });
  if (typeof value === 'string') {
    if (ISO_DATE.test(value)) return formatDateTimeSeconds(value);
    if (key === 'patrol_mode' && value in PATROL_MODE_LABELS) {
      return PATROL_MODE_LABELS[value as keyof typeof PATROL_MODE_LABELS];
    }
    if (key === 'kind' && value in JUMP_KIND_LABELS) return JUMP_KIND_LABELS[value];
    return value;
  }
  return String(value);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function MiniTable({ columns, rows }: { columns: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-grid bg-surface">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-grid bg-plane/70 text-left text-ink-2">
            {columns.map((column) => (
              <th key={column} className="px-3 py-1.5 font-semibold">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-grid/70 last:border-0">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-1.5 tabular-nums">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Nested evidence (lists of events, per-metric objects) as a small table. */
function ComplexValue({ name, value }: { name: string; value: unknown }) {
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted">—</span>;
    if (value.every(isRecord)) {
      const keys = Object.keys(value[0]);
      return (
        <MiniTable
          columns={keys.map(label)}
          rows={value.map((item) => keys.map((key) => formatScalar(key, item[key])))}
        />
      );
    }
    return (
      <span>
        {value
          .map((item) => formatScalar(name, item))
          .join(ORDERED_LIST_KEYS.has(name) ? '  →  ' : ', ')}
      </span>
    );
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length > 0 && entries.every(([, inner]) => isRecord(inner))) {
      const keys = Object.keys(entries[0][1] as Record<string, unknown>);
      return (
        <MiniTable
          columns={['Indicador', ...keys.map(label)]}
          rows={entries.map(([key, inner]) => [
            label(key),
            ...keys.map((k) => formatScalar(k, (inner as Record<string, unknown>)[k])),
          ])}
        />
      );
    }
    return (
      <MiniTable
        columns={['Dato', 'Valor']}
        rows={entries.map(([key, inner]) => [label(key), formatScalar(key, inner)])}
      />
    );
  }
  return <span>{formatScalar(name, value)}</span>;
}

function Evidence({ details }: { details: Record<string, unknown> }) {
  const entries = Object.entries(details);
  if (entries.length === 0) {
    return <p className="text-sm text-muted">Esta anomalía no tiene evidencia adjunta.</p>;
  }
  const simple = entries.filter(([, value]) => value === null || typeof value !== 'object');
  const complex = entries.filter(([, value]) => value !== null && typeof value === 'object');
  return (
    <div className="flex flex-col gap-4">
      {simple.length > 0 && (
        <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
          {simple.map(([key, value]) => (
            <div key={key} className="flex items-baseline justify-between gap-3 border-b border-grid/70 pb-1.5">
              <dt className="text-xs text-ink-2" title={key}>
                {label(key)}
              </dt>
              <dd className="text-right text-sm font-medium tabular-nums">
                {formatScalar(key, value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {complex.map(([key, value]) => (
        <div key={key}>
          <div className="mb-1.5 text-xs font-semibold text-ink-2" title={key}>
            {label(key)}
          </div>
          <ComplexValue name={key} value={value} />
        </div>
      ))}
    </div>
  );
}

export function AnomaliesPage() {
  const queryClient = useQueryClient();
  const [type, setType] = useState<AnomalyType | ''>('');
  const [severity, setSeverity] = useState<Severity | ''>('');
  const [reviewed, setReviewed] = useState<'' | 'false' | 'true'>('');
  const [guardId, setGuardId] = useState<number | ''>('');
  const [expanded, setExpanded] = useState<number | null>(null);

  const guards = useQuery({
    queryKey: ['users', 'guard'],
    queryFn: () => api<User[]>('/users?role=guard'),
  });

  const params = new URLSearchParams();
  if (type) params.set('type', type);
  if (severity) params.set('severity', severity);
  if (reviewed) params.set('reviewed', reviewed);
  if (guardId !== '') params.set('guard_id', String(guardId));
  const queryString = params.toString();
  const filtered = queryString !== '';

  const anomalies = useQuery({
    queryKey: ['anomalies', queryString],
    queryFn: () => api<Anomaly[]>(`/anomalies${queryString ? `?${queryString}` : ''}`),
  });

  const review = useMutation({
    mutationFn: ({ id, value }: { id: number; value: boolean }) =>
      api<Anomaly>(`/anomalies/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ reviewed: value }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['anomalies'] });
      void queryClient.invalidateQueries({ queryKey: ['summary'] });
    },
  });

  const rows = anomalies.data ?? [];
  const pending = rows.filter((anomaly) => !anomaly.reviewed).length;

  return (
    <div>
      <PageHeader
        title="Anomalías"
        description="Hallazgos del análisis automático de las rondas. Seleccione una fila para consultar la evidencia."
      />

      <div className="card">
        <div className="card-header">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="field-label" htmlFor="filter-type">
                Tipo
              </label>
              <select
                id="filter-type"
                className="input w-60"
                value={type}
                onChange={(e) => setType(e.target.value as AnomalyType | '')}
              >
                <option value="">Todos</option>
                {Object.entries(ANOMALY_LABELS).map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="filter-severity">
                Severidad
              </label>
              <select
                id="filter-severity"
                className="input w-36"
                value={severity}
                onChange={(e) => setSeverity(e.target.value as Severity | '')}
              >
                <option value="">Todas</option>
                {Object.entries(SEVERITY_LABELS).map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="filter-reviewed">
                Estado
              </label>
              <select
                id="filter-reviewed"
                className="input w-40"
                value={reviewed}
                onChange={(e) => setReviewed(e.target.value as '' | 'false' | 'true')}
              >
                <option value="">Todos</option>
                <option value="false">Pendientes</option>
                <option value="true">Revisadas</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="filter-guard">
                Guardia
              </label>
              <select
                id="filter-guard"
                className="input w-52"
                value={guardId}
                onChange={(e) => setGuardId(e.target.value ? Number(e.target.value) : '')}
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
                  setType('');
                  setSeverity('');
                  setReviewed('');
                  setGuardId('');
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
                <th className="w-8" />
                <th>Fecha</th>
                <th>Guardia</th>
                <th>Tipo</th>
                <th>Severidad</th>
                <th>Ronda</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((anomaly) => {
                const open = expanded === anomaly.id;
                return (
                  <Fragment key={anomaly.id}>
                    <tr
                      className="row-hover cursor-pointer"
                      aria-expanded={open}
                      onClick={() => setExpanded(open ? null : anomaly.id)}
                    >
                      <td className="!pr-0 text-muted">
                        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={16} />
                      </td>
                      <td className="whitespace-nowrap">{formatDateTime(anomaly.detected_at)}</td>
                      <td className="font-medium">{anomaly.guard_name}</td>
                      <td>{ANOMALY_LABELS[anomaly.type]}</td>
                      <td>
                        <Badge tone={SEVERITY_TONE[anomaly.severity]}>
                          {SEVERITY_LABELS[anomaly.severity]}
                        </Badge>
                      </td>
                      <td className="tabular-nums text-ink-2">
                        {anomaly.session_id !== null ? `N.º ${anomaly.session_id}` : '—'}
                      </td>
                      <td>
                        <Badge tone={anomaly.reviewed ? 'good' : 'info'}>
                          {anomaly.reviewed ? 'Revisada' : 'Pendiente'}
                        </Badge>
                      </td>
                      <td className="text-right">
                        <button
                          disabled={review.isPending}
                          onClick={(e) => {
                            e.stopPropagation();
                            review.mutate({ id: anomaly.id, value: !anomaly.reviewed });
                          }}
                          className={anomaly.reviewed ? 'link-action-muted' : 'link-action'}
                        >
                          {!anomaly.reviewed && <Icon name="check" size={14} />}
                          {anomaly.reviewed ? 'Reabrir' : 'Marcar como revisada'}
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={8} className="!bg-plane/60 !px-8 !py-5">
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-2">
                              Evidencia
                            </h3>
                            {anomaly.session_id !== null && (
                              <Link to={`/mapa?sesion=${anomaly.session_id}`} className="link-action">
                                <Icon name="map" size={14} />
                                Ver la ronda en el mapa
                              </Link>
                            )}
                          </div>
                          <Evidence details={anomaly.details} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {anomalies.isLoading && <TableMessage colSpan={8}>Cargando anomalías…</TableMessage>}
              {rows.length === 0 && !anomalies.isLoading && (
                <TableMessage colSpan={8}>
                  {filtered
                    ? 'Ninguna anomalía coincide con los filtros seleccionados.'
                    : 'No se registran anomalías.'}
                </TableMessage>
              )}
            </tbody>
          </table>
        </div>
        {!anomalies.isLoading && (
          <div className="table-footer">
            {rows.length} anomalías · {pending} pendientes de revisión
            {rows.length === 100 && ' · se muestran las 100 más recientes'}
          </div>
        )}
      </div>
    </div>
  );
}
