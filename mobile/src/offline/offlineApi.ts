import { ApiError } from '../api/errors';
import type {
  PatrolSession,
  ScanResult,
  SessionListItem,
  TokenPair,
} from '../api/types';
import { OFFLINE_DEMO_EMAIL, OFFLINE_DEMO_PASSWORD } from '../config';
import { getKv, insertOfflineScan, offlineScans, setKv } from '../db/local';
import { haversineMeters } from '../lib/geo';
import { DEMO_QR_CODES, DEMO_ROUTE, DEMO_USER } from './demoData';

const SESSIONS_KEY = 'offline_sessions';

function loadSessions(): PatrolSession[] {
  try {
    return JSON.parse(getKv(SESSIONS_KEY) ?? '[]') as PatrolSession[];
  } catch {
    return [];
  }
}

function saveSessions(sessions: PatrolSession[]): void {
  setKv(SESSIONS_KEY, JSON.stringify(sessions));
}

function readBody(init: RequestInit): Record<string, unknown> {
  try {
    return init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function scan(body: Record<string, unknown>): ScanResult {
  const sessionId = Number(body.session_id);
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const checkpointId = DEMO_QR_CODES[String(body.qr_code).toLowerCase()];
  const checkpoint = DEMO_ROUTE.checkpoints.find((cp) => cp.checkpoint_id === checkpointId);
  if (!checkpoint) throw new ApiError(404, 'Checkpoint not found');

  // Rule 1 replayed on the phone; rule 2 needs the server and is skipped.
  const distance = haversineMeters(lat, lng, checkpoint.lat, checkpoint.lng);
  const duplicate = offlineScans(sessionId).some(
    (previous) => previous.checkpoint_id === checkpoint.checkpoint_id,
  );
  const invalidReason = duplicate
    ? 'duplicate'
    : distance > checkpoint.radius_m
      ? 'out_of_range'
      : null;
  const scannedAt = new Date().toISOString();

  const id = insertOfflineScan({
    session_id: sessionId,
    checkpoint_id: checkpoint.checkpoint_id,
    checkpoint_name: checkpoint.name,
    scanned_at: scannedAt,
    lat,
    lng,
    distance_m: distance,
    is_valid: invalidReason === null ? 1 : 0,
    invalid_reason: invalidReason,
  });

  return {
    id,
    checkpoint_id: checkpoint.checkpoint_id,
    checkpoint_name: checkpoint.name,
    scanned_at: scannedAt,
    is_valid: invalidReason === null,
    invalid_reason: invalidReason,
    distance_to_checkpoint_m: Math.round(distance * 10) / 10,
    radius_m: checkpoint.radius_m,
  };
}

/**
 * Answers the endpoints the app uses, entirely on the phone. Telemetry is
 * never posted in this mode: it stays in the SQLite buffer for inspection.
 */
export async function offlineApi<T>(path: string, init: RequestInit): Promise<T> {
  const body = readBody(init);

  if (path === '/auth/login') {
    if (body.email !== OFFLINE_DEMO_EMAIL || body.password !== OFFLINE_DEMO_PASSWORD) {
      throw new ApiError(401, 'Invalid credentials');
    }
    const tokens: TokenPair = {
      access_token: 'offline',
      refresh_token: 'offline',
      token_type: 'bearer',
    };
    return tokens as T;
  }

  if (path === '/auth/me') return DEMO_USER as T;

  if (path === '/routes') return [DEMO_ROUTE] as T;

  if (path === '/sessions/start') {
    const session: PatrolSession = {
      id: -Math.floor(Date.now() / 1000),
      guard_id: DEMO_USER.id,
      route_id: Number(body.route_id),
      started_at: new Date().toISOString(),
      ended_at: null,
      status: 'in_progress',
      device_id: String(body.device_id ?? 'offline-device'),
    };
    saveSessions([session, ...loadSessions()]);
    return session as T;
  }

  const endMatch = path.match(/^\/sessions\/(-?\d+)\/end$/);
  if (endMatch) {
    const id = Number(endMatch[1]);
    const sessions = loadSessions().map((session) =>
      session.id === id
        ? { ...session, ended_at: new Date().toISOString(), status: 'completed' as const }
        : session,
    );
    saveSessions(sessions);
    return sessions.find((session) => session.id === id) as T;
  }

  if (path === '/sessions/mine') {
    const items: SessionListItem[] = loadSessions().map((session) => ({
      ...session,
      guard_name: DEMO_USER.full_name,
      route_name: DEMO_ROUTE.name,
    }));
    return items as T;
  }

  if (path === '/scans') return scan(body) as T;

  throw new ApiError(503, `Not available without a server: ${path}`);
}
