import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import Map, { GeolocateControl, Marker, NavigationControl, type MapRef } from 'react-map-gl/maplibre';

import { api, ApiError } from '../../api/client';
import type { Checkpoint, Site } from '../../api/types';
import { Icon } from '../../components/Icon';
import {
  ActiveBadge,
  Alert,
  Modal,
  PageHeader,
  TableMessage,
  useConfirm,
} from '../../components/ui';
import { DEFAULT_VIEW, OSM_STYLE } from '../../lib/mapStyle';
import { useCenterOnDevice } from '../../lib/useCenterOnDevice';

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
    <Modal
      title={`Código QR — ${checkpoint.name}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">
            Cerrar
          </button>
          <button onClick={print} disabled={!dataUrl} className="btn-primary">
            <Icon name="printer" size={16} />
            Imprimir
          </button>
        </>
      }
    >
      <div className="flex flex-col items-center">
        {dataUrl ? (
          <img src={dataUrl} alt={`Código QR de ${checkpoint.name}`} className="rounded border border-grid" />
        ) : (
          <div className="h-[280px] w-[280px] animate-pulse rounded bg-plane" />
        )}
        <p className="mt-3 break-all text-center font-mono text-xs text-muted">
          {checkpoint.qr_code}
        </p>
        <p className="mt-2 text-center text-xs text-ink-2">
          Imprima el código y colóquelo en el punto de control.
        </p>
      </div>
    </Modal>
  );
}

export function CheckpointsPage() {
  const queryClient = useQueryClient();
  const [siteId, setSiteId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [qrCheckpoint, setQrCheckpoint] = useState<Checkpoint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  const mapRef = useRef<MapRef | null>(null);

  // Start where the user is, unless they already placed or are editing one.
  const locationError = useCenterOnDevice(mapRef, () => form.id !== null || form.lat !== null);

  const sites = useQuery({ queryKey: ['sites'], queryFn: () => api<Site[]>('/sites') });
  const effectiveSiteId = siteId ?? sites.data?.[0]?.id ?? null;

  const checkpoints = useQuery({
    queryKey: ['checkpoints', effectiveSiteId],
    queryFn: () => api<Checkpoint[]>(`/checkpoints?site_id=${effectiveSiteId}`),
    enabled: effectiveSiteId !== null,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['checkpoints'] });
  const onError = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : 'Ocurrió un error inesperado.');

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
      void invalidate();
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

  const edit = (checkpoint: Checkpoint) => {
    mapRef.current?.flyTo({ center: [checkpoint.lng, checkpoint.lat], zoom: 17, duration: 600 });
    // On narrower screens the form sits below the table: bring it into view.
    document.getElementById('edit-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setForm({
      id: checkpoint.id,
      name: checkpoint.name,
      radius_m: checkpoint.radius_m,
      lat: checkpoint.lat,
      lng: checkpoint.lng,
    });
  };

  return (
    <div>
      <PageHeader
        title="Checkpoints"
        description="Puntos de control físicos de cada instalación. Cada uno tiene un código QR y un radio de validación."
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
            <h2 className="card-title">Checkpoints de la instalación</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Radio</th>
                  <th>Estado</th>
                  <th className="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {checkpoints.data?.map((checkpoint) => (
                  <tr
                    key={checkpoint.id}
                    className={`row-hover ${form.id === checkpoint.id ? '[&>td]:bg-primary-soft/60' : ''}`}
                  >
                    <td className="font-medium">{checkpoint.name}</td>
                    <td className="tabular-nums">{checkpoint.radius_m} m</td>
                    <td>
                      <ActiveBadge active={checkpoint.is_active} />
                    </td>
                    <td className="space-x-4 whitespace-nowrap text-right">
                      <button className="link-action" onClick={() => setQrCheckpoint(checkpoint)}>
                        <Icon name="qr" size={14} />
                        Código QR
                      </button>
                      <button className="link-action" onClick={() => edit(checkpoint)}>
                        Editar
                      </button>
                      <button
                        className="link-action-muted"
                        onClick={() => toggleActive.mutate(checkpoint)}
                      >
                        {checkpoint.is_active ? 'Desactivar' : 'Activar'}
                      </button>
                      <button
                        className="link-action-danger"
                        onClick={() =>
                          confirm({
                            title: 'Eliminar checkpoint',
                            message: `Se eliminará el checkpoint "${checkpoint.name}". Esta acción no se puede deshacer.`,
                            confirmLabel: 'Eliminar',
                            danger: true,
                            onConfirm: () => remove.mutate(checkpoint.id),
                          })
                        }
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
                {checkpoints.isLoading && (
                  <TableMessage colSpan={4}>Cargando checkpoints…</TableMessage>
                )}
                {checkpoints.data?.length === 0 && (
                  <TableMessage colSpan={4}>
                    Esta instalación todavía no tiene checkpoints. Utilice el formulario para crear
                    el primero.
                  </TableMessage>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card scroll-mt-20" id="edit-form">
          <div className="card-header">
            <h2 className="card-title">
              {form.id === null ? 'Nuevo checkpoint' : `Editar checkpoint: ${form.name}`}
            </h2>
          </div>
          <div className="card-body">
            <div className="mb-4 grid gap-4 sm:grid-cols-[1fr_10rem]">
              <div>
                <label className="field-label" htmlFor="cp-name">
                  Nombre
                </label>
                <input
                  id="cp-name"
                  className="input"
                  placeholder="Ej.: Garita principal"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="cp-radius">
                  Radio de validación (m)
                </label>
                <input
                  id="cp-radius"
                  type="number"
                  className="input"
                  min={5}
                  value={form.radius_m}
                  onChange={(e) => setForm({ ...form, radius_m: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
              <span className="field-label !mb-0">Ubicación</span>
              <span className="text-xs tabular-nums text-muted">
                {form.lat !== null && form.lng !== null
                  ? `${form.lat.toFixed(6)}, ${form.lng.toFixed(6)}`
                  : 'Haga clic en el mapa para ubicar el checkpoint'}
              </span>
            </div>
            <div className="h-80 overflow-hidden rounded-md border border-grid">
              <Map
                ref={mapRef}
                initialViewState={DEFAULT_VIEW}
                mapStyle={OSM_STYLE}
                cursor="crosshair"
                onClick={(e) =>
                  setForm((f) => ({ ...f, lat: e.lngLat.lat, lng: e.lngLat.lng }))
                }
              >
                <NavigationControl position="top-right" showCompass={false} />
                <GeolocateControl position="top-right" />
                {form.lat !== null && form.lng !== null && (
                  <Marker longitude={form.lng} latitude={form.lat}>
                    <div className="h-4 w-4 rounded-full bg-primary ring-2 ring-white" />
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
            {locationError && <p className="field-hint text-warning-ink">{locationError}</p>}
            <p className="field-hint">
              El escaneo se considera válido cuando el guardia está dentro del radio indicado.
            </p>

            <div className="mt-5 flex justify-end gap-2 border-t border-grid pt-4">
              {form.id !== null && (
                <button onClick={() => setForm(EMPTY_FORM)} className="btn-secondary">
                  Cancelar
                </button>
              )}
              <button
                disabled={!form.name || form.lat === null || save.isPending}
                onClick={() => save.mutate(form)}
                className="btn-primary"
              >
                {form.id === null ? 'Crear checkpoint' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {qrCheckpoint && <QrModal checkpoint={qrCheckpoint} onClose={() => setQrCheckpoint(null)} />}
      {confirmDialog}
    </div>
  );
}
