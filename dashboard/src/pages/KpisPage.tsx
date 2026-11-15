import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { api } from '../api/client';
import type { Summary } from '../api/types';
import { Icon, type IconName } from '../components/Icon';
import { Alert, PageHeader, Spinner } from '../components/ui';
import { ANOMALY_LABELS, formatDay } from '../lib/labels';

// Data marks keep the validated chart palette; chrome follows the interface tokens.
const SERIES_1 = '#2a78d6';
const STATUS_GOOD = '#0ca30c';
const STATUS_CRITICAL = '#d03b3b';
const INK_MUTED = '#6b7280';
const GRIDLINE = '#e3e7ed';
const SURFACE = '#ffffff';

const AXIS_TICK = { fill: INK_MUTED, fontSize: 12 };
const TOOLTIP_STYLE = {
  contentStyle: {
    borderRadius: 6,
    border: `1px solid ${GRIDLINE}`,
    boxShadow: '0 4px 12px rgba(16, 24, 40, 0.10)',
    fontSize: 12,
  },
  cursor: { fill: 'rgba(17, 24, 39, 0.04)' },
};

function StatTile({
  label,
  value,
  hint,
  icon,
  to,
}: {
  label: string;
  value: string;
  hint: string;
  icon: IconName;
  to?: string;
}) {
  const body = (
    <div className="card flex h-full items-start gap-4 p-5 transition-shadow hover:shadow-md">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
        <Icon name={icon} size={20} />
      </div>
      <div className="min-w-0">
        <div className="text-sm text-ink-2">{label}</div>
        <div className="mt-0.5 text-3xl font-semibold tabular-nums tracking-tight text-ink">
          {value}
        </div>
        <div className="mt-1 text-xs text-muted">{hint}</div>
      </div>
    </div>
  );
  return to ? (
    <Link to={to} className="block rounded-lg">
      {body}
    </Link>
  ) : (
    body
  );
}

function ChartCard({
  title,
  subtitle,
  children,
  heightClass = 'h-64',
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  heightClass?: string;
}) {
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h2 className="card-title">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
      </div>
      <div className={`px-5 py-4 ${heightClass}`}>{children}</div>
    </div>
  );
}

export function KpisPage() {
  const summary = useQuery({
    queryKey: ['summary'],
    queryFn: () => api<Summary>('/dashboard/summary?days=14'),
  });

  if (summary.isLoading) return <Spinner label="Cargando indicadores…" />;
  if (!summary.data) {
    return <Alert>No fue posible cargar los indicadores. Verifique la conexión con el servidor.</Alert>;
  }

  const { totals, sessions_per_day, scans_per_day, anomalies_by_type, guard_activity } =
    summary.data;

  const anomaliesData = anomalies_by_type.map((row) => ({
    ...row,
    label: ANOMALY_LABELS[row.type],
  }));

  return (
    <div>
      <PageHeader
        title="Panel general"
        description="Resumen del cumplimiento de las rondas de vigilancia en los últimos 14 días."
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon="clock"
          label="Rondas de hoy"
          value={String(totals.sessions_today)}
          hint="Iniciadas en la jornada actual"
          to="/rondas"
        />
        <StatTile
          icon="list"
          label="Rondas en 7 días"
          value={String(totals.sessions_7d)}
          hint="Total de la última semana"
          to="/rondas"
        />
        <StatTile
          icon="scan"
          label="Escaneos válidos"
          value={totals.valid_scan_pct_7d !== null ? `${totals.valid_scan_pct_7d} %` : '—'}
          hint="Sobre el total de los últimos 7 días"
        />
        <StatTile
          icon="alert"
          label="Anomalías pendientes"
          value={String(totals.open_anomalies)}
          hint="Sin revisar por un supervisor"
          to="/anomalias"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
        <ChartCard title="Rondas por día" subtitle="Rondas iniciadas cada día">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sessions_per_day} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
              <CartesianGrid stroke={GRIDLINE} vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={formatDay}
                tick={AXIS_TICK}
                axisLine={{ stroke: GRIDLINE }}
                tickLine={false}
              />
              <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <Tooltip
                {...TOOLTIP_STYLE}
                labelFormatter={(label) => formatDay(String(label))}
                formatter={(value) => [String(value), 'Rondas']}
              />
              <Bar
                dataKey="count"
                name="Rondas"
                fill={SERIES_1}
                radius={[4, 4, 0, 0]}
                maxBarSize={28}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Escaneos por día" subtitle="Escaneos válidos e inválidos de códigos QR">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={scans_per_day} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
              <CartesianGrid stroke={GRIDLINE} vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={formatDay}
                tick={AXIS_TICK}
                axisLine={{ stroke: GRIDLINE }}
                tickLine={false}
              />
              <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <Tooltip {...TOOLTIP_STYLE} labelFormatter={(label) => formatDay(String(label))} />
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 12 }}
                formatter={(value) => <span style={{ color: '#4b5563' }}>{value}</span>}
              />
              <Bar
                dataKey="valid"
                name="Válidos"
                stackId="scans"
                fill={STATUS_GOOD}
                stroke={SURFACE}
                strokeWidth={2}
                maxBarSize={28}
              />
              <Bar
                dataKey="invalid"
                name="Inválidos"
                stackId="scans"
                fill={STATUS_CRITICAL}
                stroke={SURFACE}
                strokeWidth={2}
                radius={[4, 4, 0, 0]}
                maxBarSize={28}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Anomalías por tipo"
          subtitle="Detectadas en los últimos 14 días"
          heightClass={anomaliesData.length > 6 ? 'h-96' : 'h-64'}
        >
          {anomaliesData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted">
              No se registran anomalías en el período.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={anomaliesData}
                layout="vertical"
                margin={{ top: 8, right: 24, left: 8, bottom: 0 }}
              >
                <CartesianGrid stroke={GRIDLINE} horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={232}
                  interval={0}
                  tick={AXIS_TICK}
                  axisLine={{ stroke: GRIDLINE }}
                  tickLine={false}
                />
                <Tooltip {...TOOLTIP_STYLE} formatter={(value) => [String(value), 'Anomalías']} />
                <Bar dataKey="count" name="Anomalías" fill={SERIES_1} radius={[0, 4, 4, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <div className="card self-start">
          <div className="card-header">
            <div>
              <h2 className="card-title">Actividad por guardia</h2>
              <p className="mt-0.5 text-xs text-muted">Últimos 7 días</p>
            </div>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Guardia</th>
                <th className="text-right">Rondas</th>
                <th className="text-right">Escaneos válidos</th>
                <th className="text-right">Anomalías</th>
              </tr>
            </thead>
            <tbody>
              {guard_activity.map((guard) => (
                <tr key={guard.guard_id}>
                  <td className="font-medium">{guard.guard_name}</td>
                  <td className="text-right tabular-nums">{guard.sessions_7d}</td>
                  <td className="text-right tabular-nums">
                    {guard.valid_scan_pct_7d !== null ? `${guard.valid_scan_pct_7d} %` : '—'}
                  </td>
                  <td className="text-right tabular-nums">{guard.anomalies_7d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
