import * as SQLite from 'expo-sqlite';

// Single synchronous connection; both the UI and the background location task
// use this module (each JS context opens its own handle to the same file).
const db = SQLite.openDatabaseSync('rondas.db');

db.execSync(`
  CREATE TABLE IF NOT EXISTS telemetry_buffer (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    recorded_at TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    accuracy_m REAL NOT NULL,
    speed_mps REAL,
    accel_magnitude REAL,
    accel_std REAL,
    gyro_magnitude REAL,
    is_moving INTEGER,
    UNIQUE(session_id, recorded_at)
  );
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS offline_scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    checkpoint_id INTEGER NOT NULL,
    checkpoint_name TEXT NOT NULL,
    scanned_at TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    distance_m REAL NOT NULL,
    is_valid INTEGER NOT NULL,
    invalid_reason TEXT
  );
`);

// Installs from before the gyroscope support lack the newer sensor columns.
const bufferColumns = db
  .getAllSync<{ name: string }>('PRAGMA table_info(telemetry_buffer)')
  .map((column) => column.name);
for (const column of ['accel_std', 'gyro_magnitude']) {
  if (!bufferColumns.includes(column)) {
    db.execSync(`ALTER TABLE telemetry_buffer ADD COLUMN ${column} REAL`);
  }
}

export interface BufferedPoint {
  id: number;
  session_id: number;
  recorded_at: string;
  lat: number;
  lng: number;
  accuracy_m: number;
  speed_mps: number | null;
  accel_magnitude: number | null;
  accel_std: number | null;
  gyro_magnitude: number | null;
  is_moving: number | null;
}

export function insertTelemetry(point: Omit<BufferedPoint, 'id'>): void {
  db.runSync(
    `INSERT OR IGNORE INTO telemetry_buffer
     (session_id, recorded_at, lat, lng, accuracy_m, speed_mps, accel_magnitude,
      accel_std, gyro_magnitude, is_moving)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      point.session_id,
      point.recorded_at,
      point.lat,
      point.lng,
      point.accuracy_m,
      point.speed_mps,
      point.accel_magnitude,
      point.accel_std,
      point.gyro_magnitude,
      point.is_moving,
    ],
  );
}

// Offline test sessions use negative ids: they stay on the phone and are
// never sent to the backend, which does not know them.
export function getBuffered(limit: number): BufferedPoint[] {
  return db.getAllSync<BufferedPoint>(
    'SELECT * FROM telemetry_buffer WHERE session_id > 0 ORDER BY id LIMIT ?',
    [limit],
  );
}

export function deleteBuffered(ids: number[]): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  db.runSync(`DELETE FROM telemetry_buffer WHERE id IN (${placeholders})`, ids);
}

export function bufferedCount(): number {
  const row = db.getFirstSync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM telemetry_buffer WHERE session_id > 0',
  );
  return row?.n ?? 0;
}

export function sessionPointCount(sessionId: number): number {
  const row = db.getFirstSync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM telemetry_buffer WHERE session_id = ?',
    [sessionId],
  );
  return row?.n ?? 0;
}

// --- Diagnostics and offline test data -------------------------------------

export interface TelemetryStats {
  total: number;
  offline: number;
  pending: number;
  withSensors: number;
  withGyro: number;
}

export function telemetryStats(): TelemetryStats {
  const row = db.getFirstSync<TelemetryStats>(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(session_id < 0), 0) AS offline,
            COALESCE(SUM(session_id > 0), 0) AS pending,
            COUNT(accel_std) AS withSensors,
            COUNT(gyro_magnitude) AS withGyro
     FROM telemetry_buffer`,
  );
  return row ?? { total: 0, offline: 0, pending: 0, withSensors: 0, withGyro: 0 };
}

export function recentTelemetry(limit: number): BufferedPoint[] {
  return db.getAllSync<BufferedPoint>(
    'SELECT * FROM telemetry_buffer ORDER BY id DESC LIMIT ?',
    [limit],
  );
}

export interface OfflineScan {
  id: number;
  session_id: number;
  checkpoint_id: number;
  checkpoint_name: string;
  scanned_at: string;
  lat: number;
  lng: number;
  distance_m: number;
  is_valid: number;
  invalid_reason: string | null;
}

export function insertOfflineScan(scan: Omit<OfflineScan, 'id'>): number {
  const result = db.runSync(
    `INSERT INTO offline_scans
     (session_id, checkpoint_id, checkpoint_name, scanned_at, lat, lng, distance_m,
      is_valid, invalid_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      scan.session_id,
      scan.checkpoint_id,
      scan.checkpoint_name,
      scan.scanned_at,
      scan.lat,
      scan.lng,
      scan.distance_m,
      scan.is_valid,
      scan.invalid_reason,
    ],
  );
  return result.lastInsertRowId;
}

export function offlineScans(sessionId?: number): OfflineScan[] {
  return sessionId === undefined
    ? db.getAllSync<OfflineScan>('SELECT * FROM offline_scans ORDER BY id DESC')
    : db.getAllSync<OfflineScan>(
        'SELECT * FROM offline_scans WHERE session_id = ? ORDER BY id DESC',
        [sessionId],
      );
}

export function deleteOfflineData(): void {
  db.runSync('DELETE FROM telemetry_buffer WHERE session_id < 0');
  db.runSync('DELETE FROM offline_scans');
}

export function setKv(key: string, value: string): void {
  db.runSync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', [key, value]);
}

export function getKv(key: string): string | null {
  const row = db.getFirstSync<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key]);
  return row?.value ?? null;
}

export function deleteKv(key: string): void {
  db.runSync('DELETE FROM kv WHERE key = ?', [key]);
}
