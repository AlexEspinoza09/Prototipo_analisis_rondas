import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import type { Anomaly, AnomalyType, Severity, User } from '../api/types';
import { ANOMALY_LABELS, SEVERITY_LABELS, formatDateTime } from '../lib/labels';

const SEVERITY_STYLE: Record<Severity, string> = {
  low: 'bg-grid text-ink-2',
  medium: 'bg-warning/20 text-ink',
  high: 'bg-critical/15 text-critical',
};

function DetailValue({ value }: { value: unknown }) {
  if (value !== null && typeof value === 'object') {
    return (
      <pre className="overflow-x-auto rounded bg-plane p-2 text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  return <span>{String(value)}</span>;
}

function DetailsTable({ details }: { details: Record<string, unknown> }) {
  const entries = Object.entries(details);
  if (entries.length === 0) return <p className="text-sm text-muted">Sin evidencia adjunta.</p>;
  return (
    <dl className="grid gap-x-6 gap-y-1 text-sm md:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="flex min-w-0 gap-2">
          <dt className="shrink-0 font-medium text-ink-2">{key}:</dt>
          <dd className="min-w-0 text-ink">
            <DetailValue value={value} />
          </dd>
        </div>
      ))}
    </dl>
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['anomalies'] }),
  });

  const selectClass = 'rounded border border-grid bg-surface px-2 py-1.5 text-sm';

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Anomalías</h1>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          className={selectClass}
          value={type}
          onChange={(e) => setType(e.target.value as AnomalyType | '')}
        >
          <option value="">Todos los tipos</option>
          {Object.entries(ANOMALY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          className={selectClass}
          value={severity}
          onChange={(e) => setSeverity(e.target.value as Severity | '')}
        >
          <option value="">Toda severidad</option>
          {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          className={selectClass}
          value={reviewed}
          onChange={(e) => setReviewed(e.target.value as '' | 'false' | 'true')}
        >
          <option value="">Todas</option>
          <option value="false">Pendientes</option>
          <option value="true">Revisadas</option>
        </select>
        <select
          className={selectClass}
          value={guardId}
          onChange={(e) => setGuardId(e.target.value ? Number(e.target.value) : '')}
        >
          <option value="">Todos los guardias</option>
          {guards.data?.map((guard) => (
            <option key={guard.id} value={guard.id}>
              {guard.full_name}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-grid bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-grid text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3">Fecha</th>
              <th className="px-4 py-3">Guardia</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Severidad</th>
              <th className="px-4 py-3">Sesión</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {anomalies.data?.map((anomaly) => (
              <>
                <tr
                  key={anomaly.id}
                  className="cursor-pointer border-b border-grid/60 hover:bg-plane"
                  onClick={() => setExpanded(expanded === anomaly.id ? null : anomaly.id)}
                >
                  <td className="whitespace-nowrap px-4 py-2.5">
                    {formatDateTime(anomaly.detected_at)}
                  </td>
                  <td className="px-4 py-2.5">{anomaly.guard_name}</td>
                  <td className="px-4 py-2.5">{ANOMALY_LABELS[anomaly.type]}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLE[anomaly.severity]}`}
                    >
                      {SEVERITY_LABELS[anomaly.severity]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">{anomaly.session_id ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    {anomaly.reviewed ? (
                      <span className="text-good">✓ Revisada</span>
                    ) : (
                      <span className="text-muted">Pendiente</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        review.mutate({ id: anomaly.id, value: !anomaly.reviewed });
                      }}
                      className="text-xs text-series hover:underline"
                    >
                      {anomaly.reviewed ? 'Marcar pendiente' : 'Marcar revisada'}
                    </button>
                  </td>
                </tr>
                {expanded === anomaly.id && (
                  <tr key={`${anomaly.id}-details`} className="border-b border-grid/60 bg-plane">
                    <td colSpan={7} className="px-6 py-3">
                      <DetailsTable details={anomaly.details} />
                    </td>
                  </tr>
                )}
              </>
            ))}
            {anomalies.data?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted">
                  No hay anomalías con estos filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
