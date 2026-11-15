import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import Map, {
  GeolocateControl,
  Layer,
  Marker,
  NavigationControl,
  Source,
  type MapRef,
} from 'react-map-gl/maplibre';

import { api, ApiError } from '../../api/client';
import type { Checkpoint, PatrolMode, RouteItem, Site } from '../../api/types';
import { Icon } from '../../components/Icon';
import {
  ActiveBadge,
  Alert,
  PageHeader,
  TableMessage,
  useConfirm,
} from '../../components/ui';
import { PATROL_MODE_LABELS } from '../../lib/labels';
import { DEFAULT_VIEW, OSM_STYLE } from '../../lib/mapStyle';
import { useCenterOnDevice } from '../../lib/useCenterOnDevice';

interface SelectedCheckpoint {
  checkpoint_id: number;
  expected_offset_min: number;
}

interface FormState {
  id: number | null;
  name: string;
  expected_duration_min: number;
  patrol_mode: PatrolMode;
  path: [number, number][];
  checkpoints: SelectedCheckpoint[];
}

const EMPTY_FORM: FormState = {
  id: null,
  name: '',
  expected_duration_min: 30,
  patrol_mode: 'foot',
  path: [],
  checkpoints: [],
};

export function RoutesPage() {
  const queryClient = useQueryClient();
  const [siteId, setSiteId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  const mapRef = useRef<MapRef | null>(null);

  // Start where the user is, unless they are already editing or drawing.
  const locationError = useCenterOnDevice(
    mapRef,
    () => form.id !== null || form.path.length > 0,
  );

  const sites = useQuery({ queryKey: ['sites'], queryFn: () => api<Site[]>('/sites') });
  const effectiveSiteId = siteId ?? sites.data?.[0]?.id ?? null;

  const routes = useQuery({
    queryKey: ['routes', effectiveSiteId],
    queryFn: () => api<RouteItem[]>(`/routes?site_id=${effectiveSiteId}`),
    enabled: effectiveSiteId !== null,
  });
  const checkpoints = useQuery({
    queryKey: ['checkpoints', effectiveSiteId],
    queryFn: () => api<Checkpoint[]>(`/checkpoints?site_id=${effectiveSiteId}`),
    enabled: effectiveSiteId !== null,
  });

  const pathFeature = useMemo(
    () =>
      form.path.length >= 2
        ? {
            type: 'Feature' as const,
            geometry: { type: 'LineString' as const, coordinates: form.path },
            properties: {},
          }
        : null,
    [form.path],
  );

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['routes'] });
  const onError = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : 'Ocurrió un error inesperado.');

  const save = useMutation({
    mutationFn: (payload: FormState) => {
      const body = {
        name: payload.name,
        expected_duration_min: payload.expected_duration_min,
        patrol_mode: payload.patrol_mode,
        path: payload.path.length >= 2 ? payload.path : null,
        checkpoints: payload.checkpoints.map((item, index) => ({
          checkpoint_id: item.checkpoint_id,
          sequence_order: index + 1,
          expected_offset_min: item.expected_offset_min,
        })),
      };
      return payload.id === null
        ? api<RouteItem>('/routes', {
            method: 'POST',
            body: JSON.stringify({ ...body, site_id: effectiveSiteId }),
          })
        : api<RouteItem>(`/routes/${payload.id}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
          });
    },
    onSuccess: () => {
      invalidate();
      setForm(EMPTY_FORM);
      setError(null);
    },
    onError,
  });

  const toggleActive = useMutation({
    mutationFn: (route: RouteItem) =>
      api<RouteItem>(`/routes/${route.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !route.is_active }),
      }),
    onSuccess: invalidate,
    onError,
  });

  const remove = useMutation({
    mutationFn: (id: number) => api<void>(`/routes/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError,
  });

  const toggleCheckpoint = (checkpointId: number) => {
    setForm((f) => {
      const exists = f.checkpoints.find((c) => c.checkpoint_id === checkpointId);
      return exists
        ? { ...f, checkpoints: f.checkpoints.filter((c) => c.checkpoint_id !== checkpointId) }
        : {
            ...f,
            checkpoints: [...f.checkpoints, { checkpoint_id: checkpointId, expected_offset_min: 0 }],
          };
    });
  };

  const editRoute = (route: RouteItem) => {
    const coords: [number, number][] = [
      ...(route.path ?? []),
      ...route.checkpoints.map((c) => [c.lng, c.lat] as [number, number]),
    ];
    if (coords.length > 0) {
      const lngs = coords.map((c) => c[0]);
      const lats = coords.map((c) => c[1]);
      mapRef.current?.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding: 40, maxZoom: 17, duration: 600 },
      );
    }
    // On narrower screens the form sits below the table: bring it into view.
    document.getElementById('edit-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setForm({
      id: route.id,
      name: route.name,
      expected_duration_min: route.expected_duration_min,
      patrol_mode: route.patrol_mode,
      path: route.path ?? [],
      checkpoints: route.checkpoints.map((c) => ({
        checkpoint_id: c.checkpoint_id,
        expected_offset_min: c.expected_offset_min,
      })),
    });
  };

  return (
    <div>
      <PageHeader
        title="Rutas"
        description="Recorridos esperados de cada ronda: trazado, checkpoints en orden y tiempos previstos."
        actions={
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-ink-2" htmlFor="site">
              Instalación
            </label>
            <select
              id="site"
              className="input w-64"
              value={effectiveSiteId ?? ''}
              onChange={(e) => setSiteId(Number(e.target.value))}
            >
              {sites.data?.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </div>
        }
      />

      {error && <Alert onClose={() => setError(null)}>{error}</Alert>}

      <div className="grid items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Rutas de la instalación</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Duración</th>
                  <th>Modo</th>
                  <th>Checkpoints</th>
                  <th>Estado</th>
                  <th className="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {routes.data?.map((route) => (
                  <tr
                    key={route.id}
                    className={`row-hover ${form.id === route.id ? '[&>td]:bg-primary-soft/60' : ''}`}
                  >
                    <td className="font-medium">{route.name}</td>
                    <td className="whitespace-nowrap tabular-nums">
                      {route.expected_duration_min} min
                    </td>
                    <td className="whitespace-nowrap">{PATROL_MODE_LABELS[route.patrol_mode]}</td>
                    <td className="tabular-nums">{route.checkpoints.length}</td>
                    <td>
                      <ActiveBadge active={route.is_active} />
                    </td>
                    <td className="space-x-4 whitespace-nowrap text-right">
                      <button className="link-action" onClick={() => editRoute(route)}>
                        Editar
                      </button>
                      <button
                        className="link-action-muted"
                        onClick={() => toggleActive.mutate(route)}
                      >
                        {route.is_active ? 'Desactivar' : 'Activar'}
                      </button>
                      <button
                        className="link-action-danger"
                        onClick={() =>
                          confirm({
                            title: 'Eliminar ruta',
                            message: `Se eliminará la ruta "${route.name}". Esta acción no se puede deshacer.`,
                            confirmLabel: 'Eliminar',
                            danger: true,
                            onConfirm: () => remove.mutate(route.id),
                          })
                        }
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
                {routes.isLoading && <TableMessage colSpan={6}>Cargando rutas…</TableMessage>}
                {routes.data?.length === 0 && (
                  <TableMessage colSpan={6}>
                    Esta instalación todavía no tiene rutas. Utilice el formulario para crear la
                    primera.
                  </TableMessage>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card scroll-mt-20" id="edit-form">
          <div className="card-header">
            <h2 className="card-title">
              {form.id === null ? 'Nueva ruta' : `Editar ruta: ${form.name}`}
            </h2>
          </div>
          <div className="card-body">
            <div className="mb-4 grid gap-4 sm:grid-cols-[1fr_8rem_9rem]">
              <div>
                <label className="field-label" htmlFor="route-name">
                  Nombre
                </label>
                <input
                  id="route-name"
                  className="input"
                  placeholder="Ej.: Ronda perimetral"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="route-duration">
                  Duración (min)
                </label>
                <input
                  id="route-duration"
                  type="number"
                  className="input"
                  min={1}
                  value={form.expected_duration_min}
                  onChange={(e) =>
                    setForm({ ...form, expected_duration_min: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <label className="field-label" htmlFor="route-mode">
                  Modo de patrullaje
                </label>
                <select
                  id="route-mode"
                  className="input"
                  title="Define la velocidad máxima tolerada en el análisis"
                  value={form.patrol_mode}
                  onChange={(e) => setForm({ ...form, patrol_mode: e.target.value as PatrolMode })}
                >
                  {Object.entries(PATROL_MODE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <span className="field-label !mb-0">
                Recorrido esperado{' '}
                <span className="font-normal text-muted">
                  ({form.path.length} {form.path.length === 1 ? 'punto' : 'puntos'})
                </span>
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setForm((f) => ({ ...f, path: f.path.slice(0, -1) }))}
                  disabled={form.path.length === 0}
                  className="btn-secondary btn-sm"
                >
                  <Icon name="undo" size={14} />
                  Deshacer punto
                </button>
                <button
                  onClick={() => setForm((f) => ({ ...f, path: [] }))}
                  disabled={form.path.length === 0}
                  className="btn-secondary btn-sm"
                >
                  Borrar trazado
                </button>
              </div>
            </div>
            <div className="h-80 overflow-hidden rounded-md border border-grid">
              <Map
                ref={mapRef}
                initialViewState={DEFAULT_VIEW}
                mapStyle={OSM_STYLE}
                cursor="crosshair"
                onClick={(e) =>
                  setForm((f) => ({ ...f, path: [...f.path, [e.lngLat.lng, e.lngLat.lat]] }))
                }
              >
                <NavigationControl position="top-right" showCompass={false} />
                <GeolocateControl position="top-right" />
                {pathFeature && (
                  <Source id="draft-path" type="geojson" data={pathFeature}>
                    <Layer
                      id="draft-path-line"
                      type="line"
                      paint={{ 'line-color': '#2a78d6', 'line-width': 3 }}
                    />
                  </Source>
                )}
                {checkpoints.data?.map((checkpoint) => {
                  const order =
                    form.checkpoints.findIndex((c) => c.checkpoint_id === checkpoint.id) + 1;
                  return (
                    <Marker key={checkpoint.id} longitude={checkpoint.lng} latitude={checkpoint.lat}>
                      <div
                        title={checkpoint.name}
                        className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ring-2 ring-white ${
                          order > 0 ? 'bg-primary' : 'bg-muted'
                        }`}
                      >
                        {order > 0 ? order : ''}
                      </div>
                    </Marker>
                  );
                })}
              </Map>
            </div>
            {locationError && <p className="field-hint text-warning-ink">{locationError}</p>}
            <p className="field-hint">
              Haga clic en el mapa para agregar cada punto del recorrido, en el orden en que se
              camina.
            </p>

            <div className="mb-1.5 mt-5 flex items-baseline justify-between gap-2">
              <span className="field-label !mb-0">Checkpoints de la ruta</span>
              <span className="text-xs text-muted">
                El orden de selección define la secuencia de la ronda
              </span>
            </div>
            <ul className="max-h-56 divide-y divide-grid/70 overflow-y-auto rounded-md border border-grid">
              {checkpoints.data?.map((checkpoint) => {
                const index = form.checkpoints.findIndex(
                  (c) => c.checkpoint_id === checkpoint.id,
                );
                const item = index >= 0 ? form.checkpoints[index] : null;
                return (
                  <li key={checkpoint.id} className="flex items-center gap-3 px-3 py-2">
                    <input
                      id={`route-cp-${checkpoint.id}`}
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={item !== null}
                      onChange={() => toggleCheckpoint(checkpoint.id)}
                    />
                    <label htmlFor={`route-cp-${checkpoint.id}`} className="flex flex-1 items-center gap-2 text-sm">
                      {item !== null && (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">
                          {index + 1}
                        </span>
                      )}
                      {checkpoint.name}
                    </label>
                    {item !== null && (
                      <label className="flex items-center gap-2 text-xs text-ink-2">
                        Minuto esperado
                        <input
                          type="number"
                          min={0}
                          className="input w-20 !px-2 !py-1 text-xs"
                          value={item.expected_offset_min}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              checkpoints: f.checkpoints.map((c) =>
                                c.checkpoint_id === checkpoint.id
                                  ? { ...c, expected_offset_min: Number(e.target.value) }
                                  : c,
                              ),
                            }))
                          }
                        />
                      </label>
                    )}
                  </li>
                );
              })}
              {checkpoints.data?.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-muted">
                  Primero registre los checkpoints de la instalación.
                </li>
              )}
            </ul>
            <p className="field-hint">
              El minuto esperado se cuenta desde el inicio de la ronda y se usa para evaluar los
              tiempos entre checkpoints.
            </p>

            <div className="mt-5 flex justify-end gap-2 border-t border-grid pt-4">
              {form.id !== null && (
                <button onClick={() => setForm(EMPTY_FORM)} className="btn-secondary">
                  Cancelar
                </button>
              )}
              <button
                disabled={!form.name || save.isPending}
                onClick={() => save.mutate(form)}
                className="btn-primary"
              >
                {form.id === null ? 'Crear ruta' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}
