import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import {
  ACCEL_MAX_AGE_MS,
  GPS_INTERVAL_MS,
  IS_MOVING_THRESHOLD_MPS2,
  MIN_POINT_INTERVAL_MS,
  STALE_FIX_TOLERANCE_MS,
} from '../config';
import { deleteKv, getKv, insertTelemetry, setKv } from '../db/local';
import type { SensorWindow } from './sensors';

export const LOCATION_TASK = 'rondas-location-task';

export interface LastFix {
  lat: number;
  lng: number;
  accuracy_m: number;
  ts: number;
}

function readRecentSensors(): SensorWindow | null {
  const raw = getKv('last_sensors');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SensorWindow;
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
  const sensors = readRecentSensors();
  const startedAt = Number(getKv('active_session_started') ?? 0);
  let lastStored = Number(getKv('last_point_ts') ?? 0);

  for (const location of locations) {
    // Android may hand over a cached fix from before the patrol started.
    if (location.timestamp < startedAt - STALE_FIX_TOLERANCE_MS) continue;

    const accuracy = location.coords.accuracy ?? 999;
    // The scan GPS gate always sees the freshest fix, stored or not.
    setKv(
      'last_fix',
      JSON.stringify({
        lat: location.coords.latitude,
        lng: location.coords.longitude,
        accuracy_m: accuracy,
        ts: location.timestamp,
      } satisfies LastFix),
    );
    if (location.timestamp - lastStored < MIN_POINT_INTERVAL_MS) continue;

    insertTelemetry({
      session_id: sessionId,
      recorded_at: new Date(location.timestamp).toISOString(),
      lat: location.coords.latitude,
      lng: location.coords.longitude,
      accuracy_m: accuracy,
      speed_mps: location.coords.speed !== null && location.coords.speed >= 0
        ? location.coords.speed
        : null,
      accel_magnitude: sensors?.value ?? null,
      accel_std: sensors?.std ?? null,
      gyro_magnitude: sensors?.gyro ?? null,
      is_moving: sensors !== null ? (sensors.value > IS_MOVING_THRESHOLD_MPS2 ? 1 : 0) : null,
    });
    lastStored = location.timestamp;
  }
  setKv('last_point_ts', String(lastStored));
});

export async function startTracking(sessionId: number): Promise<void> {
  setKv('active_session_id', String(sessionId));
  setKv('active_session_started', String(Date.now()));
  deleteKv('last_point_ts');
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
  deleteKv('active_session_started');
  deleteKv('last_point_ts');
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
}
