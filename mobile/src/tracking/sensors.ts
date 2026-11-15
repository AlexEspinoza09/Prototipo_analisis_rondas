import { Accelerometer, Gyroscope } from 'expo-sensors';

import { SENSOR_SAMPLE_INTERVAL_MS, SENSOR_WINDOW_MS } from '../config';
import { getKv, setKv } from '../db/local';

const GRAVITY_MPS2 = 9.80665;

// Band scanned for the movement cadence. Human walking sits at 1.5-2.5 Hz;
// 0.5-5 Hz brackets it with room for running and slow strolling.
const SPECTRUM_MIN_HZ = 0.5;
const SPECTRUM_MAX_HZ = 5.0;
const SPECTRUM_STEP_HZ = 0.1;
// Below this many samples the spectrum is too coarse to mean anything.
const SPECTRUM_MIN_SAMPLES = 32;
// Keep the scanned band safely under Nyquist for the rate we actually got.
const NYQUIST_SAFETY = 0.4;

/** One window's worth of features, named to match the telemetry columns. */
export interface SensorWindow {
  accel_magnitude: number | null;
  accel_std: number | null;
  accel_max: number | null;
  accel_dominant_hz: number | null;
  accel_peak_ratio: number | null;
  gyro_magnitude: number | null;
  gyro_std: number | null;
  gyro_max: number | null;
  gyro_dominant_hz: number | null;
  gyro_peak_ratio: number | null;
  sensor_sample_count: number | null;
}

interface Subscription {
  remove: () => void;
}

interface SeriesFeatures {
  mean: number | null;
  std: number | null;
  max: number | null;
  dominantHz: number | null;
  peakRatio: number | null;
}

const EMPTY_SERIES: SeriesFeatures = {
  mean: null,
  std: null,
  max: null,
  dominantHz: null,
  peakRatio: null,
};

function round(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

/**
 * Dominant frequency in the walking band and the share of band power sitting on
 * it. A direct DFT over ~46 candidate frequencies beats pulling in an FFT
 * dependency at this sample count, and it lets us scan only the band we care
 * about. peakRatio near 1 means strongly periodic (walking); near 0 means
 * broadband noise (vehicle vibration, phone resting on a surface).
 */
function spectralPeak(
  values: number[],
  mean: number,
  sampleRateHz: number,
): { dominantHz: number | null; peakRatio: number | null } {
  if (values.length < SPECTRUM_MIN_SAMPLES || sampleRateHz <= 0) {
    return { dominantHz: null, peakRatio: null };
  }
  const maxHz = Math.min(SPECTRUM_MAX_HZ, sampleRateHz * NYQUIST_SAFETY);
  if (maxHz <= SPECTRUM_MIN_HZ) return { dominantHz: null, peakRatio: null };

  let totalPower = 0;
  let bestPower = -1;
  let bestHz = SPECTRUM_MIN_HZ;

  for (let hz = SPECTRUM_MIN_HZ; hz <= maxHz + 1e-9; hz += SPECTRUM_STEP_HZ) {
    let real = 0;
    let imaginary = 0;
    for (let n = 0; n < values.length; n += 1) {
      // Centering on the mean removes the DC component, which would otherwise
      // dominate every bin.
      const centered = values[n] - mean;
      const angle = 2 * Math.PI * hz * (n / sampleRateHz);
      real += centered * Math.cos(angle);
      imaginary += centered * Math.sin(angle);
    }
    const power = real * real + imaginary * imaginary;
    totalPower += power;
    if (power > bestPower) {
      bestPower = power;
      bestHz = hz;
    }
  }

  if (totalPower <= 0) return { dominantHz: null, peakRatio: null };
  return { dominantHz: round(bestHz, 2), peakRatio: round(bestPower / totalPower, 3) };
}

function describe(values: number[], sampleRateHz: number): SeriesFeatures {
  if (values.length === 0) return EMPTY_SERIES;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const { dominantHz, peakRatio } = spectralPeak(values, mean, sampleRateHz);
  return {
    mean: round(mean, 3),
    std: round(Math.sqrt(variance), 3),
    max: round(Math.max(...values), 3),
    dominantHz,
    peakRatio,
  };
}

/** Subscribe without letting a missing sensor break the other one. */
function listen(
  sensor: typeof Accelerometer | typeof Gyroscope,
  onSample: (reading: { x: number; y: number; z: number }) => void,
): Subscription | null {
  try {
    sensor.setUpdateInterval(SENSOR_SAMPLE_INTERVAL_MS);
    return sensor.addListener(onSample);
  } catch {
    // Device without this sensor: its features stay null.
    return null;
  }
}

/**
 * Sample both sensors for SENSOR_WINDOW_MS and reduce each series to the
 * features an activity-recognition model needs. Raw samples are never stored:
 * at 20 Hz an 8-hour shift would be ~576k rows per sensor.
 *
 * Called from the background location task rather than a foreground timer: the
 * foreground service started by expo-location keeps the app eligible for sensor
 * updates under the Android 9+ background restrictions, so this keeps producing
 * values with the screen off. Always resolves — a sensor that never reports
 * yields nulls instead of hanging the task.
 */
export async function sampleSensorWindow(): Promise<SensorWindow> {
  const accelValues: number[] = [];
  const gyroValues: number[] = [];

  const startedAt = Date.now();
  const accelSub = listen(Accelerometer, ({ x, y, z }) => {
    // expo reports g units; deviation from 1 g approximates linear acceleration.
    accelValues.push(Math.abs(Math.sqrt(x * x + y * y + z * z) - 1) * GRAVITY_MPS2);
  });
  const gyroSub = listen(Gyroscope, ({ x, y, z }) => {
    // Already rad/s; magnitude of the angular velocity vector.
    gyroValues.push(Math.sqrt(x * x + y * y + z * z));
  });

  try {
    await new Promise((resolve) => setTimeout(resolve, SENSOR_WINDOW_MS));
  } finally {
    accelSub?.remove();
    gyroSub?.remove();
  }

  // Measured, not assumed: Android throttles delivery per device and OEM, so the
  // requested 20 Hz is an upper bound rather than a guarantee.
  const elapsedS = Math.max(1, Date.now() - startedAt) / 1000;
  const sampleCount = Math.max(accelValues.length, gyroValues.length);
  const accel = describe(accelValues, accelValues.length / elapsedS);
  const gyro = describe(gyroValues, gyroValues.length / elapsedS);

  return {
    accel_magnitude: accel.mean,
    accel_std: accel.std,
    accel_max: accel.max,
    accel_dominant_hz: accel.dominantHz,
    accel_peak_ratio: accel.peakRatio,
    gyro_magnitude: gyro.mean,
    gyro_std: gyro.std,
    gyro_max: gyro.max,
    gyro_dominant_hz: gyro.dominantHz,
    gyro_peak_ratio: gyro.peakRatio,
    sensor_sample_count: sampleCount > 0 ? sampleCount : null,
  };
}

/** A sensor window plus when it was taken, kept for the diagnostics screen. */
export interface StoredSensorWindow extends SensorWindow {
  ts: number;
}

export function storeSensorWindow(window: SensorWindow): StoredSensorWindow {
  const stored = { ...window, ts: Date.now() };
  setKv('last_sensors', JSON.stringify(stored));
  return stored;
}

export function readLastSensorWindow(): StoredSensorWindow | null {
  const raw = getKv('last_sensors');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredSensorWindow;
    // Windows stored by an older build used different field names.
    return 'accel_magnitude' in parsed ? parsed : null;
  } catch {
    return null;
  }
}
