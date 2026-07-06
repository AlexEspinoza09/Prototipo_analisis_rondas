import { useQuery } from '@tanstack/react-query';
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
import { ANOMALY_LABELS, formatDay } from '../lib/labels';

// Palette roles (validated reference palette, light mode).
const SERIES_1 = '#2a78d6';
const STATUS_GOOD = '#0ca30c';
const STATUS_CRITICAL = '#d03b3b';
const INK_MUTED = '#898781';
const GRIDLINE = '#e1e0d9';
const SURFACE = '#fcfcfb';

const AXIS_TICK = { fill: INK_MUTED, fontSize: 12 };

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-grid bg-surface p-4">
      <div className="text-sm text-ink-2">{label}</div>
      <div className="mt-1 text-3xl font-semibold text-ink">{value}</div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-grid bg-surface p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink">{title}</h2>
      <div className="h-64">{children}</div>
    </div>
  );
}

export function KpisPage() {
  const summary = useQuery({
    queryKey: ['summary'],
    queryFn: () => api<Summary>('/dashboard/summary?days=14'),
  });

  if (summary.isLoading) return <p className="text-muted">Cargando KPIs…</p>;
  if (!summary.data) return <p className="text-critical">No se pudo cargar el resumen.</p>;

  const { totals, sessions_per_day, scans_per_day, anomalies_by_type, guard_activity } =
    summary.data;

  const anomaliesData = anomalies_by_type.map((row) => ({
    ...row,
    label: ANOMALY_LABELS[row.type],
  }));

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">KPIs — últimos 14 días</h1>

      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatTile label="Rondas hoy" value={String(totals.sessions_today)} />
        <StatTile label="Rondas (7 días)" value={String(totals.sessions_7d)} />
        <StatTile
          label="Escaneos válidos (7 días)"
          value={totals.valid_scan_pct_7d !== null ? `${totals.valid_scan_pct_7d}%` : '—'}
        />
        <StatTile label="Anomalías sin revisar" value={String(totals.open_anomalies)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Rondas por día">
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

        <ChartCard title="Escaneos por día (válidos vs. inválidos)">
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
              <Tooltip labelFormatter={(label) => formatDay(String(label))} />
              <Legend />
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

        <ChartCard title="Anomalías por tipo (14 días)">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={anomaliesData}
              layout="vertical"
              margin={{ top: 8, right: 24, left: 40, bottom: 0 }}
            >
              <CartesianGrid stroke={GRIDLINE} horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <YAxis
                type="category"
                dataKey="label"
                width={140}
                tick={AXIS_TICK}
                axisLine={{ stroke: GRIDLINE }}
                tickLine={false}
              />
              <Tooltip formatter={(value) => [String(value), 'Anomalías']} />
              <Bar dataKey="count" name="Anomalías" fill={SERIES_1} radius={[0, 4, 4, 0]} maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <div className="rounded-lg border border-grid bg-surface p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink">Actividad por guardia (7 días)</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-grid text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2">Guardia</th>
                <th className="py-2 text-right">Rondas</th>
                <th className="py-2 text-right">% escaneos válidos</th>
                <th className="py-2 text-right">Anomalías</th>
              </tr>
            </thead>
            <tbody>
              {guard_activity.map((guard) => (
                <tr key={guard.guard_id} className="border-b border-grid/60 last:border-0">
                  <td className="py-2">{guard.guard_name}</td>
                  <td className="py-2 text-right tabular-nums">{guard.sessions_7d}</td>
                  <td className="py-2 text-right tabular-nums">
                    {guard.valid_scan_pct_7d !== null ? `${guard.valid_scan_pct_7d}%` : '—'}
                  </td>
                  <td className="py-2 text-right tabular-nums">{guard.anomalies_7d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
