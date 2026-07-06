import { Accelerometer } from 'expo-sensors';

import {
  ACCEL_EVERY_MS,
  ACCEL_SAMPLE_INTERVAL_MS,
  ACCEL_WINDOW_MS,
} from '../config';
import { setKv } from '../db/local';

const GRAVITY_MPS2 = 9.80665;

let windowTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Every ACCEL_EVERY_MS, sample the accelerometer for ACCEL_WINDOW_MS and store
 * only the mean deviation from gravity (m/s^2) in the kv table, where the
 * background GPS task picks it up.
 *
 * Prototype limitation: expo-sensors only samples while the app process is in
 * the foreground; with the screen off, points carry accel_magnitude = null and
 * the backend defers rule 2.
 */
export function startAccelSampling(): void {
  if (windowTimer !== null) return;
  const sampleWindow = () => {
    const magnitudes: number[] = [];
    Accelerometer.setUpdateInterval(ACCEL_SAMPLE_INTERVAL_MS);
    const subscription = Accelerometer.addListener(({ x, y, z }) => {
      // expo reports in g units; deviation from 1 g approximates linear acceleration.
      magnitudes.push(Math.abs(Math.sqrt(x * x + y * y + z * z) - 1) * GRAVITY_MPS2);
    });
    setTimeout(() => {
      subscription.remove();
      if (magnitudes.length === 0) return;
      const mean = magnitudes.reduce((total, value) => total + value, 0) / magnitudes.length;
      setKv('last_accel', JSON.stringify({ value: Number(mean.toFixed(3)), ts: Date.now() }));
    }, ACCEL_WINDOW_MS);
  };
  sampleWindow();
  windowTimer = setInterval(sampleWindow, ACCEL_EVERY_MS);
}

export function stopAccelSampling(): void {
  if (windowTimer !== null) {
    clearInterval(windowTimer);
    windowTimer = null;
  }
}
