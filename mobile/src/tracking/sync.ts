import NetInfo from '@react-native-community/netinfo';

import { api } from '../api/client';
import {
  SYNC_BACKOFF_MAX_MS,
  SYNC_BACKOFF_START_MS,
  SYNC_BATCH_MAX,
  SYNC_INTERVAL_MS,
} from '../config';
import { deleteBuffered, getBuffered, type BufferedPoint } from '../db/local';

let timer: ReturnType<typeof setInterval> | null = null;
let unsubscribeNetInfo: (() => void) | null = null;
let backoffMs = SYNC_BACKOFF_START_MS;
let blockedUntil = 0;
let running = false;

function toPayloadPoint(point: BufferedPoint) {
  return {
    recorded_at: point.recorded_at,
    lat: point.lat,
    lng: point.lng,
    accuracy_m: point.accuracy_m,
    speed_mps: point.speed_mps,
    accel_magnitude: point.accel_magnitude,
    is_moving: point.is_moving === null ? null : point.is_moving === 1,
  };
}

/** Push every buffered point to the backend, one batch per session. */
export async function flushNow(): Promise<boolean> {
  if (running) return true;
  running = true;
  try {
    for (;;) {
      const rows = getBuffered(SYNC_BATCH_MAX);
      if (rows.length === 0) return true;
      const bySession = new Map<number, BufferedPoint[]>();
      for (const row of rows) {
        const group = bySession.get(row.session_id) ?? [];
        group.push(row);
        bySession.set(row.session_id, group);
      }
      for (const [sessionId, points] of bySession) {
        await api('/telemetry/batch', {
          method: 'POST',
          body: JSON.stringify({
            session_id: sessionId,
            points: points.map(toPayloadPoint),
          }),
        });
        deleteBuffered(points.map((point) => point.id));
      }
    }
  } catch {
    return false;
  } finally {
    running = false;
  }
}

async function tick(): Promise<void> {
  if (Date.now() < blockedUntil) return;
  const ok = await flushNow();
  if (ok) {
    backoffMs = SYNC_BACKOFF_START_MS;
    blockedUntil = 0;
  } else {
    blockedUntil = Date.now() + backoffMs;
    backoffMs = Math.min(backoffMs * 2, SYNC_BACKOFF_MAX_MS);
  }
}

export function startSync(): void {
  if (timer !== null) return;
  timer = setInterval(() => void tick(), SYNC_INTERVAL_MS);
  unsubscribeNetInfo = NetInfo.addEventListener((state) => {
    // Connectivity came back: retry immediately regardless of backoff.
    if (state.isConnected) {
      blockedUntil = 0;
      void tick();
    }
  });
  void tick();
}

export function stopSync(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  unsubscribeNetInfo?.();
  unsubscribeNetInfo = null;
}
