import { Accelerometer, Gyroscope } from 'expo-sensors';

import {
  ACCEL_EVERY_MS,
  ACCEL_SAMPLE_INTERVAL_MS,
  ACCEL_WINDOW_MS,
} from '../config';
import { getKv, setKv } from '../db/local';

const GRAVITY_MPS2 = 9.80665;

/** Summary of one sensor window, stored in kv for the background GPS task. */
export interface SensorWindow {
  /** Mean deviation of the acceleration magnitude from gravity (m/s^2). */
  value: number;
  /** Standard deviation of that deviation: how much the phone shakes (m/s^2). */
  std: number;
  /** Mean rotation rate (rad/s); null on devices without a gyroscope. */
  gyro: number | null;
  ts: number;
}

let windowTimer: ReturnType<typeof setInterval> | null = null;
let gyroAvailable: boolean | null = null;

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * Every ACCEL_EVERY_MS, sample accelerometer and gyroscope for ACCEL_WINDOW_MS
 * and store only the window summary (no raw samples) in the kv table, where
 * the background GPS task attaches it to the next points.
 *
 * Prototype limitation: expo-sensors only samples while the app process is in
 * the foreground; with the screen off, points carry null sensor fields and the
 * backend defers the rules that need them.
 */
export function startSensorSampling(): void {
  if (windowTimer !== null) return;
  const sampleWindow = async () => {
    if (gyroAvailable === null) {
      gyroAvailable = await Gyroscope.isAvailableAsync().catch(() => false);
    }
    const accelSamples: number[] = [];
    const gyroSamples: number[] = [];

    Accelerometer.setUpdateInterval(ACCEL_SAMPLE_INTERVAL_MS);
    const accelSub = Accelerometer.addListener(({ x, y, z }) => {
      // expo reports in g units; deviation from 1 g approximates linear acceleration.
      accelSamples.push(Math.abs(Math.sqrt(x * x + y * y + z * z) - 1) * GRAVITY_MPS2);
    });
    let gyroSub: { remove: () => void } | null = null;
    if (gyroAvailable) {
      Gyroscope.setUpdateInterval(ACCEL_SAMPLE_INTERVAL_MS);
      gyroSub = Gyroscope.addListener(({ x, y, z }) => {
        gyroSamples.push(Math.sqrt(x * x + y * y + z * z)); // rad/s
      });
    }

    setTimeout(() => {
      accelSub.remove();
      gyroSub?.remove();
      if (accelSamples.length === 0) return;
      const accelMean = mean(accelSamples);
      const variance = mean(accelSamples.map((value) => (value - accelMean) ** 2));
      setKv(
        'last_sensors',
        JSON.stringify({
          value: Number(accelMean.toFixed(3)),
          std: Number(Math.sqrt(variance).toFixed(4)),
          gyro: gyroSamples.length > 0 ? Number(mean(gyroSamples).toFixed(4)) : null,
          ts: Date.now(),
        } satisfies SensorWindow),
      );
    }, ACCEL_WINDOW_MS);
  };
  void sampleWindow();
  windowTimer = setInterval(() => void sampleWindow(), ACCEL_EVERY_MS);
}

/** Latest sensor window, however old (the GPS task applies its own max age). */
export function readLastSensorWindow(): SensorWindow | null {
  const raw = getKv('last_sensors');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SensorWindow;
  } catch {
    return null;
  }
}

export function stopSensorSampling(): void {
  if (windowTimer !== null) {
    clearInterval(windowTimer);
    windowTimer = null;
  }
}
