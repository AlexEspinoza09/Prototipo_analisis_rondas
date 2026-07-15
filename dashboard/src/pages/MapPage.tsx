import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import MapView, { Layer, Marker, Source, type MapRef } from 'react-map-gl/maplibre';

import { api } from '../api/client';
import type { RouteItem, SessionListItem, SessionScan, TrackFeature } from '../api/types';
import { DEFAULT_VIEW, OSM_STYLE } from '../lib/mapStyle';
import { REASON_LABELS, STATUS_LABELS, formatDateTime } from '../lib/labels';

const COLOR_TRACK = '#2a78d6';
const COLOR_EXPECTED = '#898781';
const COLOR_VALID = '#0ca30c';
const COLOR_INVALID = '#d03b3b';
const COLOR_UNVISITED = '#898781';

type CheckpointState = 'valid' | 'invalid' | 'unvisited';

const STATE_COLOR: Record<CheckpointState, string> = {
  valid: COLOR_VALID,
  invalid: COLOR_INVALID,
  unvisited: COLOR_UNVISITED,
};

const STATE_LABEL: Record<CheckpointState, string> = {
  valid: 'Escaneo válido',
  invalid: 'Escaneo inválido',
  unvisited: 'No visitado',
};

export function MapPage() {
  // Allow deep-linking a session from the "Rondas" records view (?sesion=ID).
  const [searchParams] = useSearchParams();
  const [sessionId, setSessionId] = useState<number | null>(
    Number(searchParams.get('sesion')) || null,
  );
  const mapRef = useRef<MapRef | null>(null);

  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api<SessionListItem[]>('/sessions?limit=100'),
  });

  const selected = sessions.data?.find((s) => s.id === sessionId) ?? null;

  const track = useQuery({
    queryKey: ['track', sessionId],
    queryFn: () => api<TrackFeature>(`/sessions/${sessionId}/track`),
    enabled: sessionId !== null,
  });
  const scans = useQuery({
    queryKey: ['session-scans', sessionId],
    queryFn: () => api<SessionScan[]>(`/sessions/${sessionId}/scans`),
    enabled: sessionId !== null,
  });
  const route = useQuery({
    queryKey: ['route', selected?.route_id],
    queryFn: () => api<RouteItem>(`/routes/${selected?.route_id}`),
    enabled: selected !== null,
  });

  const expectedFeature = useMemo(() => {
    if (!route.data?.path) return null;
    return {
      type: 'Feature' as const,
      geometry: { type: 'LineString' as const, coordinates: route.data.path },
      properties: {},
    };
  }, [route.data]);

  const checkpointStates = useMemo(() => {
    const byId = new Map<number, CheckpointState>();
    for (const cp of route.data?.checkpoints ?? []) byId.set(cp.checkpoint_id, 'unvisited');
    for (const scan of scans.data ?? []) {
      const previous = byId.get(scan.checkpoint_id);
      // A valid scan wins over an earlier invalid one.
      if (previous !== 'valid') byId.set(scan.checkpoint_id, scan.is_valid ? 'valid' : 'invalid');
    }
    return byId;
  }, [route.data, scans.data]);

  useEffect(() => {
    const coords: [number, number][] = [
      ...(track.data?.geometry?.coordinates ?? []),
      ...(expectedFeature?.geometry.coordinates ?? []),
      ...(route.data?.checkpoints.map((cp) => [cp.lng, cp.lat] as [number, number]) ?? []),
    ];
    if (coords.length < 2 || !mapRef.current) return;
    const lngs = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    mapRef.current.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 60, duration: 600 },
    );
  }, [track.data, expectedFeature, route.data]);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">Mapa de rondas</h1>
        <select
          className="min-w-72 rounded border border-grid bg-surface px-3 py-2 text-sm"
          value={sessionId ?? ''}
          onChange={(e) => setSessionId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Selecciona una sesión…</option>
          {sessions.data?.map((s) => (
            <option key={s.id} value={s.id}>
              #{s.id} · {s.guard_name} · {s.route_name} · {formatDateTime(s.started_at)} ·{' '}
              {STATUS_LABELS[s.status]}
            </option>
          ))}
        </select>
        {sessions.isLoading && <span className="text-sm text-muted">Cargando sesiones…</span>}
      </div>

      <div className="relative min-h-[480px] flex-1 overflow-hidden rounded-lg border border-grid">
        <MapView ref={mapRef} initialViewState={DEFAULT_VIEW} mapStyle={OSM_STYLE}>
          {expectedFeature && (
            <Source id="expected" type="geojson" data={expectedFeature}>
              <Layer
                id="expected-line"
                type="line"
                paint={{
                  'line-color': COLOR_EXPECTED,
                  'line-width': 2,
                  'line-dasharray': [2, 2],
                }}
              />
            </Source>
          )}
          {track.data?.geometry && (
            <Source id="track" type="geojson" data={track.data}>
              <Layer
                id="track-line"
                type="line"
                paint={{ 'line-color': COLOR_TRACK, 'line-width': 3 }}
              />
            </Source>
          )}
          {route.data?.checkpoints.map((cp) => {
            const state = checkpointStates.get(cp.checkpoint_id) ?? 'unvisited';
            return (
              <Marker key={cp.checkpoint_id} longitude={cp.lng} latitude={cp.lat}>
                <div
                  title={`${cp.sequence_order}. ${cp.name} — ${STATE_LABEL[state]}`}
                  className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white ring-2 ring-white"
                  style={{ backgroundColor: STATE_COLOR[state] }}
                >
                  {cp.sequence_order}
                </div>
              </Marker>
            );
          })}
        </MapView>
        <div className="absolute bottom-3 left-3 rounded border border-grid bg-surface/95 p-3 text-xs">
          <div className="mb-1 flex items-center gap-2">
            <span className="inline-block h-0.5 w-6" style={{ backgroundColor: COLOR_TRACK }} />
            Trayectoria real
          </div>
          <div className="mb-1 flex items-center gap-2">
            <span
              className="inline-block h-0.5 w-6 border-t-2 border-dashed"
              style={{ borderColor: COLOR_EXPECTED }}
            />
            Ruta esperada
          </div>
          {(['valid', 'invalid', 'unvisited'] as const).map((state) => (
            <div key={state} className="mb-1 flex items-center gap-2 last:mb-0">
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ backgroundColor: STATE_COLOR[state] }}
              />
              {STATE_LABEL[state]}
            </div>
          ))}
        </div>
      </div>

      {selected && (
        <div className="rounded-lg border border-grid bg-surface p-4">
          <h2 className="mb-2 text-sm font-semibold">
            Escaneos de la sesión #{selected.id} ({track.data?.properties.point_count ?? 0} puntos
            GPS)
          </h2>
          {scans.data?.length ? (
            <ul className="grid gap-1 text-sm md:grid-cols-2">
              {scans.data.map((scan) => (
                <li key={scan.id} className="flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: scan.is_valid ? COLOR_VALID : COLOR_INVALID }}
                  />
                  <span className="text-ink-2">
                    {scan.checkpoint_name} · {formatDateTime(scan.scanned_at)} ·{' '}
                    {scan.distance_to_checkpoint_m} m
                    {scan.invalid_reason ? ` · ${REASON_LABELS[scan.invalid_reason]}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Sin escaneos registrados.</p>
          )}
        </div>
      )}
    </div>
  );
}
