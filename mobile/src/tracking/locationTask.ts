import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import {
  GPS_INTERVAL_MS,
  IS_MOVING_THRESHOLD_MPS2,
  IS_MOVING_THRESHOLD_RADS,
  MIN_POINT_INTERVAL_MS,
  STALE_FIX_TOLERANCE_MS,
} from '../config';
import { deleteKv, getKv, insertTelemetry, setKv } from '../db/local';
import { sampleSensorWindow, storeSensorWindow, type SensorWindow } from './sensors';

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
  const startedAt = Number(getKv('active_session_started') ?? 0);
  let lastStored = Number(getKv('last_point_ts') ?? 0);

  const toStore: Location.LocationObject[] = [];
  for (const location of locations) {
    // Android may hand over a cached fix from before the patrol started.
    if (location.timestamp < startedAt - STALE_FIX_TOLERANCE_MS) continue;

    // The scan GPS gate always sees the freshest fix, stored or not.
    setKv(
      'last_fix',
      JSON.stringify({
        lat: location.coords.latitude,
        lng: location.coords.longitude,
        accuracy_m: location.coords.accuracy ?? 999,
        ts: location.timestamp,
      } satisfies LastFix),
    );
    if (location.timestamp - lastStored < MIN_POINT_INTERVAL_MS) continue;
    toStore.push(location);
    lastStored = location.timestamp;
  }
  if (toStore.length === 0) return;
  // Saved before the 5 s sensor window below, so a burst of task runs that
  // overlap it cannot all store a point.
  setKv('last_point_ts', String(lastStored));

  // Sampled here, inside the headless context, so readings keep coming with the
  // app in background — the foreground service makes the sensors available.
  const sensors = await sampleSensorWindow();
  storeSensorWindow(sensors);
  const isMoving = deriveIsMoving(sensors);

  for (const location of toStore) {
    insertTelemetry({
      session_id: sessionId,
      recorded_at: new Date(location.timestamp).toISOString(),
      lat: location.coords.latitude,
      lng: location.coords.longitude,
      accuracy_m: location.coords.accuracy ?? 999,
      speed_mps: location.coords.speed !== null && location.coords.speed >= 0
        ? location.coords.speed
        : null,
      ...sensors,
      is_moving: isMoving,
    });
  }
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
      notificationBody: 'Se está registrando el recorrido para validar la ronda.',
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
