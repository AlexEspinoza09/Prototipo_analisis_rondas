import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import Map, { Layer, Marker, Source } from 'react-map-gl/maplibre';

import { api, ApiError } from '../../api/client';
import type { Checkpoint, RouteItem, Site } from '../../api/types';
import { DEFAULT_VIEW, OSM_STYLE } from '../../lib/mapStyle';

interface SelectedCheckpoint {
  checkpoint_id: number;
  expected_offset_min: number;
}

interface FormState {
  id: number | null;
  name: string;
  expected_duration_min: number;
  path: [number, number][];
  checkpoints: SelectedCheckpoint[];
}

const EMPTY_FORM: FormState = {
  id: null,
  name: '',
  expected_duration_min: 30,
  path: [],
  checkpoints: [],
};

export function RoutesPage() {
  const queryClient = useQueryClient();
  const [siteId, setSiteId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

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
    setError(err instanceof ApiError ? err.message : 'Error inesperado');

  const save = useMutation({
    mutationFn: (payload: FormState) => {
      const body = {
        name: payload.name,
        expected_duration_min: payload.expected_duration_min,
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

  const editRoute = (route: RouteItem) =>
    setForm({
      id: route.id,
      name: route.name,
      expected_duration_min: route.expected_duration_min,
      path: route.path ?? [],
      checkpoints: route.checkpoints.map((c) => ({
        checkpoint_id: c.checkpoint_id,
        expected_offset_min: c.expected_offset_min,
      })),
    });

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-semibold">Rutas</h1>
        <select
          className="rounded border border-grid bg-surface px-3 py-2 text-sm"
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

      {error && <p className="mb-3 text-sm text-critical">{error}</p>}

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="overflow-x-auto rounded-lg border border-grid bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-grid text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Nombre</th>
                <th className="px-4 py-3">Duración</th>
                <th className="px-4 py-3">Checkpoints</th>
                <th className="px-4 py-3">Activa</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {routes.data?.map((route) => (
                <tr key={route.id} className="border-b border-grid/60 last:border-0">
                  <td className="px-4 py-2.5">{route.name}</td>
                  <td className="px-4 py-2.5">{route.expected_duration_min} min</td>
                  <td className="px-4 py-2.5">{route.checkpoints.length}</td>
                  <td className="px-4 py-2.5">{route.is_active ? 'Sí' : 'No'}</td>
                  <td className="space-x-3 px-4 py-2.5 text-right text-xs">
                    <button className="text-series hover:underline" onClick={() => editRoute(route)}>
                      Editar
                    </button>
                    <button
                      className="text-ink-2 hover:underline"
                      onClick={() => toggleActive.mutate(route)}
                    >
                      {route.is_active ? 'Desactivar' : 'Activar'}
                    </button>
                    <button
                      className="text-critical hover:underline"
                      onClick={() => {
                        if (confirm(`¿Eliminar "${route.name}"?`)) remove.mutate(route.id);
                      }}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
              {routes.data?.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted">
                    Sin rutas en este sitio.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-grid bg-surface p-4">
          <h2 className="mb-3 text-sm font-semibold">
            {form.id === null ? 'Nueva ruta' : `Editando #${form.id}`}
          </h2>
          <div className="mb-3 flex gap-2">
            <input
              className="flex-1 rounded border border-grid px-3 py-2 text-sm"
              placeholder="Nombre de la ruta"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <input
              type="number"
              className="w-24 rounded border border-grid px-3 py-2 text-sm"
              title="Duración esperada (min)"
              min={1}
              value={form.expected_duration_min}
              onChange={(e) =>
                setForm({ ...form, expected_duration_min: Number(e.target.value) })
              }
            />
          </div>
          <p className="mb-2 text-xs text-muted">
            Haz clic en el mapa para dibujar el recorrido esperado ({form.path.length} puntos).
          </p>
          <div className="mb-2 h-72 overflow-hidden rounded border border-grid">
            <Map
              initialViewState={DEFAULT_VIEW}
              mapStyle={OSM_STYLE}
              onClick={(e) =>
                setForm((f) => ({ ...f, path: [...f.path, [e.lngLat.lng, e.lngLat.lat]] }))
              }
            >
              {pathFeature && (
                <Source id="draft-path" type="geojson" data={pathFeature}>
                  <Layer
                    id="draft-path-line"
                    type="line"
                    paint={{ 'line-color': '#2a78d6', 'line-width': 3 }}
                  />
                </Source>
              )}
              {checkpoints.data?.map((checkpoint) => (
                <Marker key={checkpoint.id} longitude={checkpoint.lng} latitude={checkpoint.lat}>
                  <div
                    title={checkpoint.name}
                    className={`h-3.5 w-3.5 rounded-full ring-2 ring-white ${
                      form.checkpoints.some((c) => c.checkpoint_id === checkpoint.id)
                        ? 'bg-series'
                        : 'bg-muted'
                    }`}
                  />
                </Marker>
              ))}
            </Map>
          </div>
          <div className="mb-3 flex gap-2">
            <button
              onClick={() => setForm((f) => ({ ...f, path: f.path.slice(0, -1) }))}
              disabled={form.path.length === 0}
              className="rounded border border-grid px-3 py-1.5 text-xs disabled:opacity-50"
            >
              Deshacer punto
            </button>
            <button
              onClick={() => setForm((f) => ({ ...f, path: [] }))}
              disabled={form.path.length === 0}
              className="rounded border border-grid px-3 py-1.5 text-xs disabled:opacity-50"
            >
              Limpiar trazo
            </button>
          </div>

          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
            Checkpoints de la ruta (en orden de selección)
          </h3>
          <ul className="mb-3 max-h-40 overflow-y-auto text-sm">
            {checkpoints.data?.map((checkpoint) => {
              const index = form.checkpoints.findIndex(
                (c) => c.checkpoint_id === checkpoint.id,
              );
              const item = index >= 0 ? form.checkpoints[index] : null;
              return (
                <li key={checkpoint.id} className="flex items-center gap-2 py-1">
                  <input
                    type="checkbox"
                    checked={item !== null}
                    onChange={() => toggleCheckpoint(checkpoint.id)}
                  />
                  <span className="flex-1">
                    {item !== null && (
                      <span className="mr-1 font-semibold text-series">{index + 1}.</span>
                    )}
                    {checkpoint.name}
                  </span>
                  {item !== null && (
                    <label className="flex items-center gap-1 text-xs text-muted">
                      min
                      <input
                        type="number"
                        min={0}
                        className="w-16 rounded border border-grid px-2 py-1 text-xs"
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
          </ul>

          <div className="flex gap-2">
            <button
              disabled={!form.name || save.isPending}
              onClick={() => save.mutate(form)}
              className="rounded bg-series px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
            >
              {form.id === null ? 'Crear ruta' : 'Guardar cambios'}
            </button>
            {form.id !== null && (
              <button
                onClick={() => setForm(EMPTY_FORM)}
                className="rounded border border-grid px-4 py-2 text-sm"
              >
                Cancelar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
