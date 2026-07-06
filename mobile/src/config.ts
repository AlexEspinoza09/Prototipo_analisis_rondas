export const API_URL: string = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:8000';

// Tracking cadence (see CLAUDE.md — mobile scope)
export const GPS_INTERVAL_MS = 15_000;
export const ACCEL_WINDOW_MS = 5_000;
export const ACCEL_EVERY_MS = 30_000;
export const ACCEL_SAMPLE_INTERVAL_MS = 50;
// A sensor window older than this is considered stale and not attached to points.
export const ACCEL_MAX_AGE_MS = 60_000;
// Mean deviation from gravity (m/s^2) above which we consider the guard moving.
export const IS_MOVING_THRESHOLD_MPS2 = 0.8;

// Sync
export const SYNC_INTERVAL_MS = 120_000;
export const SYNC_BATCH_MAX = 500;
export const SYNC_BACKOFF_START_MS = 10_000;
export const SYNC_BACKOFF_MAX_MS = 15 * 60_000;

// QR scan GPS quality gate
export const SCAN_MAX_FIX_AGE_MS = 30_000;
export const SCAN_MAX_ACCURACY_M = 50;
