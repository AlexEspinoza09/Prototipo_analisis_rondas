import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import Map, { Marker } from 'react-map-gl/maplibre';

import { api, ApiError } from '../../api/client';
import type { Checkpoint, Site } from '../../api/types';
import { DEFAULT_VIEW, OSM_STYLE } from '../../lib/mapStyle';

interface FormState {
  id: number | null;
  name: string;
  radius_m: number;
  lat: number | null;
  lng: number | null;
}

const EMPTY_FORM: FormState = { id: null, name: '', radius_m: 30, lat: null, lng: null };

function QrModal({ checkpoint, onClose }: { checkpoint: Checkpoint; onClose: () => void }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    QRCode.toDataURL(checkpoint.qr_code, { width: 280, margin: 2 }).then(setDataUrl);
  }, [checkpoint.qr_code]);

  const print = () => {
    if (!dataUrl) return;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`
      <html><head><title>QR — ${checkpoint.name}</title></head>
      <body style="display:flex;flex-direction:column;align-items:center;font-family:sans-serif">
        <h2>${checkpoint.name}</h2>
        <img src="${dataUrl}" alt="QR" />
        <p style="font-size:12px;color:#555">${checkpoint.qr_code}</p>
        <script>window.onload = () => window.print()</script>
      </body></html>
    `);
    win.document.close();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40"
      onClick={onClose}
    >
      <div
        className="flex flex-col items-center rounded-lg bg-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-2 font-semibold">{checkpoint.name}</h2>
        {dataUrl && <img src={dataUrl} alt="Código QR" />}
        <p className="mb-4 mt-2 max-w-72 break-all text-center text-xs text-muted">
          {checkpoint.qr_code}
        </p>
        <div className="flex gap-2">
          <button
            onClick={print}
            className="rounded bg-series px-4 py-2 text-sm text-white hover:opacity-90"
          >
            Imprimir
          </button>
          <button onClick={onClose} className="rounded border border-grid px-4 py-2 text-sm">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

export function CheckpointsPage() {
  const queryClient = useQueryClient();
  const [siteId, setSiteId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [qrCheckpoint, setQrCheckpoint] = useState<Checkpoint | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sites = useQuery({ queryKey: ['sites'], queryFn: () => api<Site[]>('/sites') });
  const effectiveSiteId = siteId ?? sites.data?.[0]?.id ?? null;

  const checkpoints = useQuery({
    queryKey: ['checkpoints', effectiveSiteId],
    queryFn: () => api<Checkpoint[]>(`/checkpoints?site_id=${effectiveSiteId}`),
    enabled: effectiveSiteId !== null,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['checkpoints'] });
  const onError = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : 'Error inesperado');

  const save = useMutation({
    mutationFn: (payload: FormState) => {
      const body = {
        name: payload.name,
        radius_m: payload.radius_m,
        lat: payload.lat,
        lng: payload.lng,
      };
      return payload.id === null
        ? api<Checkpoint>('/checkpoints', {
            method: 'POST',
            body: JSON.stringify({ ...body, site_id: effectiveSiteId }),
          })
        : api<Checkpoint>(`/checkpoints/${payload.id}`, {
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
    mutationFn: (checkpoint: Checkpoint) =>
      api<Checkpoint>(`/checkpoints/${checkpoint.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !checkpoint.is_active }),
      }),
    onSuccess: invalidate,
    onError,
  });

  const remove = useMutation({
    mutationFn: (id: number) => api<void>(`/checkpoints/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError,
  });

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-semibold">Checkpoints</h1>
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
                <th className="px-4 py-3">Radio</th>
                <th className="px-4 py-3">Activo</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {checkpoints.data?.map((checkpoint) => (
                <tr key={checkpoint.id} className="border-b border-grid/60 last:border-0">
                  <td className="px-4 py-2.5">{checkpoint.name}</td>
                  <td className="px-4 py-2.5">{checkpoint.radius_m} m</td>
                  <td className="px-4 py-2.5">{checkpoint.is_active ? 'Sí' : 'No'}</td>
                  <td className="space-x-3 px-4 py-2.5 text-right text-xs">
                    <button
                      className="text-series hover:underline"
                      onClick={() => setQrCheckpoint(checkpoint)}
                    >
                      QR
                    </button>
                    <button
                      className="text-series hover:underline"
                      onClick={() =>
                        setForm({
                          id: checkpoint.id,
                          name: checkpoint.name,
                          radius_m: checkpoint.radius_m,
                          lat: checkpoint.lat,
                          lng: checkpoint.lng,
                        })
                      }
                    >
                      Editar
                    </button>
                    <button
                      className="text-ink-2 hover:underline"
                      onClick={() => toggleActive.mutate(checkpoint)}
                    >
                      {checkpoint.is_active ? 'Desactivar' : 'Activar'}
                    </button>
                    <button
                      className="text-critical hover:underline"
                      onClick={() => {
                        if (confirm(`¿Eliminar "${checkpoint.name}"?`)) {
                          remove.mutate(checkpoint.id);
                        }
                      }}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
              {checkpoints.data?.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted">
                    Sin checkpoints en este sitio.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-grid bg-surface p-4">
          <h2 className="mb-3 text-sm font-semibold">
            {form.id === null ? 'Nuevo checkpoint' : `Editando #${form.id}`}
          </h2>
          <div className="mb-3 flex gap-2">
            <input
              className="flex-1 rounded border border-grid px-3 py-2 text-sm"
              placeholder="Nombre del checkpoint"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <input
              type="number"
              className="w-24 rounded border border-grid px-3 py-2 text-sm"
              title="Radio de validación (m)"
              min={5}
              value={form.radius_m}
              onChange={(e) => setForm({ ...form, radius_m: Number(e.target.value) })}
            />
          </div>
          <p className="mb-2 text-xs text-muted">
            Haz clic en el mapa para ubicar el checkpoint.
            {form.lat !== null && form.lng !== null && (
              <>
                {' '}
                Posición: {form.lat.toFixed(6)}, {form.lng.toFixed(6)}
              </>
            )}
          </p>
          <div className="mb-3 h-72 overflow-hidden rounded border border-grid">
            <Map
              initialViewState={DEFAULT_VIEW}
              mapStyle={OSM_STYLE}
              onClick={(e) =>
                setForm((f) => ({ ...f, lat: e.lngLat.lat, lng: e.lngLat.lng }))
              }
            >
              {form.lat !== null && form.lng !== null && (
                <Marker longitude={form.lng} latitude={form.lat}>
                  <div className="h-4 w-4 rounded-full bg-series ring-2 ring-white" />
                </Marker>
              )}
              {checkpoints.data?.map((checkpoint) =>
                checkpoint.id !== form.id ? (
                  <Marker
                    key={checkpoint.id}
                    longitude={checkpoint.lng}
                    latitude={checkpoint.lat}
                  >
                    <div
                      title={checkpoint.name}
                      className="h-3 w-3 rounded-full bg-muted ring-2 ring-white"
                    />
                  </Marker>
                ) : null,
              )}
            </Map>
          </div>
          <div className="flex gap-2">
            <button
              disabled={!form.name || form.lat === null || save.isPending}
              onClick={() => save.mutate(form)}
              className="rounded bg-series px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
            >
              {form.id === null ? 'Crear' : 'Guardar cambios'}
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

      {qrCheckpoint && <QrModal checkpoint={qrCheckpoint} onClose={() => setQrCheckpoint(null)} />}
    </div>
  );
}
