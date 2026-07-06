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
    is_moving INTEGER,
    UNIQUE(session_id, recorded_at)
  );
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

export interface BufferedPoint {
  id: number;
  session_id: number;
  recorded_at: string;
  lat: number;
  lng: number;
  accuracy_m: number;
  speed_mps: number | null;
  accel_magnitude: number | null;
  is_moving: number | null;
}

export function insertTelemetry(point: Omit<BufferedPoint, 'id'>): void {
  db.runSync(
    `INSERT OR IGNORE INTO telemetry_buffer
     (session_id, recorded_at, lat, lng, accuracy_m, speed_mps, accel_magnitude, is_moving)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      point.session_id,
      point.recorded_at,
      point.lat,
      point.lng,
      point.accuracy_m,
      point.speed_mps,
      point.accel_magnitude,
      point.is_moving,
    ],
  );
}

export function getBuffered(limit: number): BufferedPoint[] {
  return db.getAllSync<BufferedPoint>(
    'SELECT * FROM telemetry_buffer ORDER BY id LIMIT ?',
    [limit],
  );
}

export function deleteBuffered(ids: number[]): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  db.runSync(`DELETE FROM telemetry_buffer WHERE id IN (${placeholders})`, ids);
}

export function bufferedCount(): number {
  const row = db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM telemetry_buffer');
  return row?.n ?? 0;
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
