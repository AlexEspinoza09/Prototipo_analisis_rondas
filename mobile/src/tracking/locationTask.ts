import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { ACCEL_MAX_AGE_MS, GPS_INTERVAL_MS, IS_MOVING_THRESHOLD_MPS2 } from '../config';
import { deleteKv, getKv, insertTelemetry, setKv } from '../db/local';

export const LOCATION_TASK = 'rondas-location-task';

export interface LastFix {
  lat: number;
  lng: number;
  accuracy_m: number;
  ts: number;
}

interface AccelWindow {
  value: number;
  ts: number;
}

function readRecentAccel(): AccelWindow | null {
  const raw = getKv('last_accel');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AccelWindow;
    return Date.now() - parsed.ts <= ACCEL_MAX_AGE_MS ? parsed : null;
  } catch {
    return null;
  }
}

export function readLastFix(): LastFix | null {
  const raw = getKv('last_fix');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LastFix;
  } catch {
    return null;
  }
}

export function activeSessionId(): number | null {
  const raw = getKv('active_session_id');
  return raw ? Number(raw) : null;
}

// Runs in a headless JS context while the patrol is active, even with the app
// in background (Android foreground service shows the ongoing notification).
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const sessionId = activeSessionId();
  if (sessionId === null) return;

  const { locations } = data as { locations: Location.LocationObject[] };
  const accel = readRecentAccel();

  for (const location of locations) {
    const accuracy = location.coords.accuracy ?? 999;
    insertTelemetry({
      session_id: sessionId,
      recorded_at: new Date(location.timestamp).toISOString(),
      lat: location.coords.latitude,
      lng: location.coords.longitude,
      accuracy_m: accuracy,
      speed_mps: location.coords.speed !== null && location.coords.speed >= 0
        ? location.coords.speed
        : null,
      accel_magnitude: accel?.value ?? null,
      is_moving: accel !== null ? (accel.value > IS_MOVING_THRESHOLD_MPS2 ? 1 : 0) : null,
    });
    setKv(
      'last_fix',
      JSON.stringify({
        lat: location.coords.latitude,
        lng: location.coords.longitude,
        accuracy_m: accuracy,
        ts: location.timestamp,
      } satisfies LastFix),
    );
  }
});

export async function startTracking(sessionId: number): Promise<void> {
  setKv('active_session_id', String(sessionId));
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: GPS_INTERVAL_MS,
    distanceInterval: 0,
    foregroundService: {
      notificationTitle: 'Ronda en curso',
      notificationBody: 'Registrando tu recorrido para validar la ronda.',
      killServiceOnDestroy: false,
    },
  });
}

export async function stopTracking(): Promise<void> {
  deleteKv('active_session_id');
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
}
