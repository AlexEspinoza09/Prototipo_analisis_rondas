import { useEffect, useRef, useState, type RefObject } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';

const DEVICE_ZOOM = 17;

const ERROR_MESSAGES: Record<number, string> = {
  1: 'El navegador no tiene permiso de ubicación para este sitio.',
  2: 'Ubicación no disponible: activa la ubicación de Windows (Configuración → Privacidad y seguridad → Ubicación).',
  3: 'Se agotó el tiempo para obtener tu ubicación.',
};

/**
 * Centres the map on the device's current location as soon as the browser
 * shares it. Geolocation only works on localhost or HTTPS; if it fails, the
 * map keeps its initial view and the returned message says why.
 *
 * `skip` is checked when the position arrives, so a map the user already
 * moved on purpose (e.g. by editing an item) is not yanked away.
 */
export function useCenterOnDevice(
  mapRef: RefObject<MapRef | null>,
  skip: () => boolean,
): string | null {
  const skipRef = useRef(skip);
  skipRef.current = skip;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!window.isSecureContext) {
      setError('La ubicación solo funciona abriendo el panel en http://localhost:5173 o con HTTPS.');
      return;
    }
    if (!('geolocation' in navigator)) {
      setError('Este navegador no permite obtener la ubicación.');
      return;
    }
    let active = true;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (!active) return;
        setError(null);
        if (skipRef.current()) return;
        mapRef.current?.flyTo({
          center: [coords.longitude, coords.latitude],
          zoom: DEVICE_ZOOM,
          duration: 800,
        });
      },
      (err) => {
        if (active) setError(ERROR_MESSAGES[err.code] ?? 'No se pudo obtener tu ubicación.');
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
    return () => {
      active = false;
    };
  }, [mapRef]);

  return error;
}
