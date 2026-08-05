import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import {
  GPS_INTERVAL_MS,
  IS_MOVING_THRESHOLD_MPS2,
  IS_MOVING_THRESHOLD_RADS,
} from '../config';
import { deleteKv, getKv, insertTelemetry, setKv } from '../db/local';
import { sampleSensorWindow, type SensorWindow } from './sensors';

export const LOCATION_TASK = 'rondas-location-task';

export interface LastFix {
  lat: number;
  lng: number;
  accuracy_m: number;
  ts: number;
}

/** null when neither sensor reported, so the backend defers business rule 2. */
function deriveIsMoving(sensors: SensorWindow): number | null {
  const { accel_magnitude: accel, gyro_magnitude: gyro } = sensors;
  if (accel === null && gyro === null) return null;
  const moving =
    (accel ?? 0) > IS_MOVING_THRESHOLD_MPS2 || (gyro ?? 0) > IS_MOVING_THRESHOLD_RADS;
  return moving ? 1 : 0;
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
  // Sampled here, inside the headless context, so readings keep coming with the
  // app in background — the foreground service makes the sensors available.
  const sensors = await sampleSensorWindow();
  const isMoving = deriveIsMoving(sensors);

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
      accel_magnitude: sensors.accel_magnitude,
      gyro_magnitude: sensors.gyro_magnitude,
      is_moving: isMoving,
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
