import * as Location from 'expo-location';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import { api } from '../api/client';
import type { PatrolSession, RouteItem } from '../api/types';
import { deleteKv, getKv, setKv } from '../db/local';
import { startAccelSampling, stopAccelSampling } from '../tracking/accelerometer';
import { startTracking, stopTracking } from '../tracking/locationTask';
import { flushNow, startSync, stopSync } from '../tracking/sync';

export interface ActivePatrol {
  sessionId: number;
  route: RouteItem;
  scannedCheckpointIds: number[];
}

interface PatrolState {
  patrol: ActivePatrol | null;
  loading: boolean;
  startPatrol: (route: RouteItem, deviceId: string) => Promise<void>;
  endPatrol: () => Promise<void>;
  registerScan: (checkpointId: number) => void;
}

const PatrolContext = createContext<PatrolState | null>(null);

const KV_KEY = 'active_patrol';

export function PatrolProvider({ children }: { children: ReactNode }) {
  const [patrol, setPatrol] = useState<ActivePatrol | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Resume a patrol that survived an app restart.
    const raw = getKv(KV_KEY);
    if (raw) {
      try {
        const saved = JSON.parse(raw) as ActivePatrol;
        setPatrol(saved);
        startAccelSampling();
        startSync();
      } catch {
        deleteKv(KV_KEY);
      }
    }
    setLoading(false);
  }, []);

  const persist = (value: ActivePatrol | null) => {
    setPatrol(value);
    if (value === null) {
      deleteKv(KV_KEY);
    } else {
      setKv(KV_KEY, JSON.stringify(value));
    }
  };

  const startPatrol = useCallback(async (route: RouteItem, deviceId: string) => {
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (foreground.status !== 'granted') {
      throw new Error('Se necesita el permiso de ubicación para iniciar la ronda.');
    }
    const background = await Location.requestBackgroundPermissionsAsync();
    if (background.status !== 'granted') {
      throw new Error(
        'Activa "Permitir todo el tiempo" en el permiso de ubicación para registrar la ronda en segundo plano.',
      );
    }
    const session = await api<PatrolSession>('/sessions/start', {
      method: 'POST',
      body: JSON.stringify({ route_id: route.id, device_id: deviceId }),
    });
    await startTracking(session.id);
    startAccelSampling();
    startSync();
    persist({ sessionId: session.id, route, scannedCheckpointIds: [] });
  }, []);

  const endPatrol = useCallback(async () => {
    if (!patrol) return;
    await stopTracking();
    stopAccelSampling();
    await flushNow();
    stopSync();
    await api(`/sessions/${patrol.sessionId}/end`, { method: 'POST' });
    persist(null);
  }, [patrol]);

  const registerScan = useCallback(
    (checkpointId: number) => {
      if (!patrol) return;
      if (patrol.scannedCheckpointIds.includes(checkpointId)) return;
      persist({
        ...patrol,
        scannedCheckpointIds: [...patrol.scannedCheckpointIds, checkpointId],
      });
    },
    [patrol],
  );

  return (
    <PatrolContext.Provider value={{ patrol, loading, startPatrol, endPatrol, registerScan }}>
      {children}
    </PatrolContext.Provider>
  );
}

export function usePatrol(): PatrolState {
  const ctx = useContext(PatrolContext);
  if (!ctx) throw new Error('usePatrol must be used inside PatrolProvider');
  return ctx;
}
