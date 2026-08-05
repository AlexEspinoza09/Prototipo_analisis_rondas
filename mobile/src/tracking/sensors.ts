import { Accelerometer, Gyroscope } from 'expo-sensors';

import { SENSOR_SAMPLE_INTERVAL_MS, SENSOR_WINDOW_MS } from '../config';

const GRAVITY_MPS2 = 9.80665;

export interface SensorWindow {
  accel_magnitude: number | null;
  gyro_magnitude: number | null;
}

interface Subscription {
  remove: () => void;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Number((total / values.length).toFixed(3));
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
    // Device without this sensor: its magnitude stays null.
    return null;
  }
}

/**
 * Sample both sensors for SENSOR_WINDOW_MS and return the mean magnitudes.
 *
 * Called from the background location task rather than a foreground timer: the
 * foreground service started by expo-location keeps the app eligible for sensor
 * updates under the Android 9+ background restrictions, so this keeps producing
 * values with the screen off. Always resolves — a sensor that never reports
 * yields null instead of hanging the task.
 */
export async function sampleSensorWindow(): Promise<SensorWindow> {
  const accelValues: number[] = [];
  const gyroValues: number[] = [];

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

  return { accel_magnitude: mean(accelValues), gyro_magnitude: mean(gyroValues) };
}
