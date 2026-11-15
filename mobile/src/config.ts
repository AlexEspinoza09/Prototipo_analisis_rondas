export const API_URL: string = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:8000';

// Test builds only: shows a "no server" switch on the login screen so the app
// can be exercised in the field with no backend (see src/offline/).
export const ALLOW_OFFLINE_MODE = process.env.EXPO_PUBLIC_ALLOW_OFFLINE_MODE === 'true';
export const OFFLINE_DEMO_EMAIL = 'guardia1@rondas.demo';
export const OFFLINE_DEMO_PASSWORD = 'Guardia123!';

// Tracking cadence (see CLAUDE.md — mobile scope)
export const GPS_INTERVAL_MS = 15_000;
// Android may deliver fixes far more often than requested (bursts every ~2 s
// when another app asks for location): store at most one point per interval.
export const MIN_POINT_INTERVAL_MS = 12_000;
// A fix this much older than the patrol start is a stale cached position.
export const STALE_FIX_TOLERANCE_MS = 10_000;
// Accelerometer + gyroscope window, sampled inside the background location task
// once per GPS fix, so every point carries its own fresh sensor reading.
// 5 s at ~20 Hz gives ~100 samples: enough for a 0.2 Hz spectral resolution,
// which is what separates a walking cadence from vehicle vibration.
export const SENSOR_WINDOW_MS = 5_000;
export const SENSOR_SAMPLE_INTERVAL_MS = 50;
// Mean deviation from gravity (m/s^2) above which we consider the guard moving.
export const IS_MOVING_THRESHOLD_MPS2 = 0.8;
// Mean angular speed (rad/s) above which the phone is being carried rather than
// resting on a surface — catches walking that the accelerometer alone misses.
export const IS_MOVING_THRESHOLD_RADS = 0.35;

// Sync
export const SYNC_INTERVAL_MS = 120_000;
export const SYNC_BATCH_MAX = 500;
export const SYNC_BACKOFF_START_MS = 10_000;
export const SYNC_BACKOFF_MAX_MS = 15 * 60_000;

// QR scan GPS quality gate
export const SCAN_MAX_FIX_AGE_MS = 30_000;
export const SCAN_MAX_ACCURACY_M = 50;
