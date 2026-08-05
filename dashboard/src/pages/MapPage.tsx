import { useQuery } from '@tanstack/react-query';
import type { Feature, FeatureCollection } from 'geojson';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import MapView, { Layer, Marker, Source, type MapRef } from 'react-map-gl/maplibre';

import { api } from '../api/client';
import type { RouteItem, SessionListItem, SessionScan, TrackFeature } from '../api/types';
import { DEFAULT_VIEW, VECTOR_3D_STYLE } from '../lib/mapStyle';
import { REASON_LABELS, STATUS_LABELS, formatDateTime } from '../lib/labels';

const COLOR_TRACK = '#2a78d6';
const COLOR_PROGRESS = '#104281'; // blue 650: walked portion of the track
const COLOR_EXPECTED = '#898781';
const COLOR_VALID = '#0ca30c';
const COLOR_INVALID = '#d03b3b';
const COLOR_UNVISITED = '#898781';

const PLAYBACK_PITCH = 55;
const SPEED_OPTIONS = [10, 30, 60, 120];

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

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] };

function lerpAngle(from: number, to: number, k: number): number {
  const delta = ((to - from + 540) % 360) - 180;
  return from + delta * k;
}

/** Ensure the style has extruded 3D buildings (OpenMapTiles `building` layer). */
function setup3dBuildings(map: MapLibreMap): void {
  const style = map.getStyle();
  if (!style.layers || style.layers.some((layer) => layer.type === 'fill-extrusion')) return;
  const vectorSource = Object.entries(style.sources ?? {}).find(
    ([, source]) => (source as { type?: string }).type === 'vector',
  )?.[0];
  if (!vectorSource) return;
  const firstSymbolId = style.layers.find((layer) => layer.type === 'symbol')?.id;
  const layer = {
    id: 'buildings-3d',
    type: 'fill-extrusion',
    source: vectorSource,
    'source-layer': 'building',
    minzoom: 14,
    paint: {
      'fill-extrusion-color': '#d9d5cc',
      'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 12],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      'fill-extrusion-opacity': 0.75,
    },
  };
  map.addLayer(layer as Parameters<MapLibreMap['addLayer']>[0], firstSymbolId);
}

interface PlaybackRef {
  rafId: number;
  wallStart: number;
  simStart: number;
  simTime: number;
  bearing: number;
  segment: number;
}

export function MapPage() {
  // Allow deep-linking a session from the "Rondas" records view (?sesion=ID).
  const [searchParams] = useSearchParams();
  const [sessionId, setSessionId] = useState<number | null>(
    Number(searchParams.get('sesion')) || null,
  );
  const mapRef = useRef<MapRef | null>(null);

  const [is3d, setIs3d] = useState(false);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(30);
  const [clock, setClock] = useState<string | null>(null);
  const playRef = useRef<PlaybackRef | null>(null);
  const speedRef = useRef(speed);
  const clockUpdatedAt = useRef(0);

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

  const coords = track.data?.geometry?.coordinates ?? null;
  const timesMs = useMemo(
    () => (track.data?.properties.times ?? []).map((iso) => Date.parse(iso)),
    [track.data],
  );
  const canPlay =
    coords !== null && coords.length >= 2 && timesMs.length === coords.length;

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

  const setPlaybackData = useCallback((runner: Feature | null, progress: Feature | null) => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    (map.getSource('runner') as GeoJSONSource | undefined)?.setData(
      runner ?? EMPTY_FC,
    );
    (map.getSource('progress') as GeoJSONSource | undefined)?.setData(
      progress ?? EMPTY_FC,
    );
  }, []);

  const step = useCallback(
    (now: number) => {
      const st = playRef.current;
      const map = mapRef.current?.getMap();
      if (!st || !map || !coords) return;

      st.simTime = st.simStart + (now - st.wallStart) * speedRef.current;
      const lastT = timesMs[timesMs.length - 1];
      const t = Math.min(st.simTime, lastT);

      while (st.segment < timesMs.length - 2 && timesMs[st.segment + 1] <= t) st.segment += 1;
      const i = st.segment;
      const t0 = timesMs[i];
      const t1 = timesMs[i + 1];
      const f = t1 > t0 ? Math.min(1, (t - t0) / (t1 - t0)) : 1;
      const [x0, y0] = coords[i];
      const [x1, y1] = coords[i + 1];
      const pos: [number, number] = [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];

      setPlaybackData(
        { type: 'Feature', geometry: { type: 'Point', coordinates: pos }, properties: {} },
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [...coords.slice(0, i + 1), pos],
          },
          properties: {},
        },
      );

      const targetBearing = (Math.atan2(x1 - x0, y1 - y0) * 180) / Math.PI;
      st.bearing = lerpAngle(st.bearing, targetBearing, 0.08);
      map.jumpTo({ center: pos, bearing: st.bearing });

      if (now - clockUpdatedAt.current > 300) {
        clockUpdatedAt.current = now;
        setClock(new Date(t).toLocaleTimeString('es-EC'));
      }

      if (st.simTime >= lastT) {
        setPlaying(false);
        return;
      }
      st.rafId = requestAnimationFrame(step);
    },
    [coords, timesMs, setPlaybackData],
  );

  const startPlayback = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map || !coords || !canPlay) return;
    setStarted(true);
    setPlaying(true);
    setIs3d(true);
    playRef.current = {
      rafId: 0,
      wallStart: performance.now(),
      simStart: timesMs[0],
      simTime: timesMs[0],
      bearing: map.getBearing(),
      segment: 0,
    };
    map.easeTo({
      center: coords[0] as [number, number],
      zoom: Math.max(map.getZoom(), 16.5),
      pitch: PLAYBACK_PITCH,
      duration: 700,
    });
    playRef.current.rafId = requestAnimationFrame(step);
  }, [coords, canPlay, timesMs, step]);

  const pausePlayback = useCallback(() => {
    if (playRef.current) cancelAnimationFrame(playRef.current.rafId);
    setPlaying(false);
  }, []);

  const resumePlayback = useCallback(() => {
    const st = playRef.current;
    if (!st) return;
    st.wallStart = performance.now();
    st.simStart = st.simTime;
    setPlaying(true);
    st.rafId = requestAnimationFrame(step);
  }, [step]);

  const stopPlayback = useCallback(() => {
    if (playRef.current) cancelAnimationFrame(playRef.current.rafId);
    playRef.current = null;
    setStarted(false);
    setPlaying(false);
    setClock(null);
    setPlaybackData(null, null);
    const map = mapRef.current?.getMap();
    map?.easeTo({ pitch: is3d ? PLAYBACK_PITCH : 0, bearing: 0, duration: 600 });
  }, [is3d, setPlaybackData]);

  const changeSpeed = (value: number) => {
    setSpeed(value);
    speedRef.current = value;
    const st = playRef.current;
    if (st) {
      st.simStart = st.simTime;
      st.wallStart = performance.now();
    }
  };

  const toggle3d = () => {
    const next = !is3d;
    setIs3d(next);
    mapRef.current
      ?.getMap()
      .easeTo({ pitch: next ? PLAYBACK_PITCH : 0, bearing: next ? undefined : 0, duration: 600 });
  };

  // Changing session invalidates any running playback.
  useEffect(() => {
    if (playRef.current) cancelAnimationFrame(playRef.current.rafId);
    playRef.current = null;
    setStarted(false);
    setPlaying(false);
    setClock(null);
    setPlaybackData(null, null);
  }, [sessionId, setPlaybackData]);

  useEffect(() => {
    if (started) return; // don't fight the playback camera
    const allCoords: [number, number][] = [
      ...((coords ?? []) as [number, number][]),
      ...(expectedFeature?.geometry.coordinates ?? []),
      ...(route.data?.checkpoints.map((cp) => [cp.lng, cp.lat] as [number, number]) ?? []),
    ];
    if (allCoords.length < 2 || !mapRef.current) return;
    const lngs = allCoords.map((c) => c[0]);
    const lats = allCoords.map((c) => c[1]);
    mapRef.current.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 60, duration: 600 },
    );
  }, [coords, expectedFeature, route.data, started]);

  const buttonClass =
    'rounded border border-grid bg-surface px-3 py-1.5 text-sm hover:bg-plane disabled:opacity-50';

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
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

        <div className="ml-auto flex items-center gap-2">
          <button className={buttonClass} onClick={toggle3d} aria-pressed={is3d}>
            {is3d ? 'Vista 2D' : 'Vista 3D'}
          </button>
          {!started || !playing ? (
            <button
              className={buttonClass}
              disabled={!canPlay}
              title={canPlay ? 'Reproducir el recorrido' : 'Sesión sin trayectoria suficiente'}
              onClick={started ? resumePlayback : startPlayback}
            >
              ▶ {started ? 'Continuar' : 'Reproducir ronda'}
            </button>
          ) : (
            <button className={buttonClass} onClick={pausePlayback}>
              ⏸ Pausar
            </button>
          )}
          {started && (
            <button className={buttonClass} onClick={stopPlayback}>
              ■ Detener
            </button>
          )}
          <select
            className="rounded border border-grid bg-surface px-2 py-1.5 text-sm"
            value={speed}
            onChange={(e) => changeSpeed(Number(e.target.value))}
            title="Velocidad de reproducción"
          >
            {SPEED_OPTIONS.map((option) => (
              <option key={option} value={option}>
                x{option}
              </option>
            ))}
          </select>
          {clock && (
            <span className="text-sm tabular-nums text-ink-2" title="Hora simulada de la ronda">
              🕐 {clock}
            </span>
          )}
        </div>
      </div>

      <div className="relative min-h-[480px] flex-1 overflow-hidden rounded-lg border border-grid">
        <MapView
          ref={mapRef}
          initialViewState={DEFAULT_VIEW}
          mapStyle={VECTOR_3D_STYLE}
          onLoad={(evt) => setup3dBuildings(evt.target)}
        >
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
          <Source id="progress" type="geojson" data={EMPTY_FC}>
            <Layer
              id="progress-line"
              type="line"
              paint={{ 'line-color': COLOR_PROGRESS, 'line-width': 4 }}
            />
          </Source>
          <Source id="runner" type="geojson" data={EMPTY_FC}>
            <Layer
              id="runner-dot"
              type="circle"
              paint={{
                'circle-radius': 8,
                'circle-color': COLOR_TRACK,
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2,
              }}
            />
          </Source>
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
          {started && (
            <div className="mb-1 flex items-center gap-2">
              <span
                className="inline-block h-1 w-6 rounded"
                style={{ backgroundColor: COLOR_PROGRESS }}
              />
              Recorrido reproducido
            </div>
          )}
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
