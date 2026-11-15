import { ALLOW_OFFLINE_MODE } from '../config';
import { deleteKv, getKv, setKv } from '../db/local';

const KV_KEY = 'offline_mode';

/** True while the app runs with no backend (test builds only). */
export function isOfflineMode(): boolean {
  return ALLOW_OFFLINE_MODE && getKv(KV_KEY) === '1';
}

export function setOfflineMode(enabled: boolean): void {
  if (enabled && ALLOW_OFFLINE_MODE) {
    setKv(KV_KEY, '1');
  } else {
    deleteKv(KV_KEY);
  }
}
