import type { RouteItem, User } from '../api/types';
import { OFFLINE_DEMO_EMAIL } from '../config';

// Mirror of the backend seeds (`python -m app.seeds`), so the QR codes printed
// from the dashboard are recognised with no server.
export const DEMO_USER: User = {
  id: -1,
  full_name: 'Guardia de prueba (sin servidor)',
  email: OFFLINE_DEMO_EMAIL,
  role: 'guard',
  is_active: true,
};

export const DEMO_ROUTE: RouteItem = {
  id: 1,
  site_id: 1,
  name: 'Ronda perimetral (prueba sin servidor)',
  expected_duration_min: 25,
  patrol_mode: 'foot',
  is_active: true,
  path: [
    [-78.4855, -0.1855],
    [-78.481, -0.1855],
    [-78.481, -0.1825],
    [-78.4855, -0.1825],
    [-78.4855, -0.1855],
  ],
  checkpoints: [
    { checkpoint_id: 1, name: 'Garita principal', sequence_order: 1, expected_offset_min: 0, lat: -0.1855, lng: -78.4855, radius_m: 30 },
    { checkpoint_id: 2, name: 'Bodega', sequence_order: 2, expected_offset_min: 7, lat: -0.1855, lng: -78.481, radius_m: 30 },
    { checkpoint_id: 3, name: 'Cuarto de máquinas', sequence_order: 3, expected_offset_min: 12, lat: -0.1825, lng: -78.481, radius_m: 30 },
    { checkpoint_id: 4, name: 'Acceso posterior', sequence_order: 4, expected_offset_min: 19, lat: -0.1825, lng: -78.4855, radius_m: 30 },
  ],
};

/** QR code (UUID printed on the checkpoint) -> checkpoint id. */
export const DEMO_QR_CODES: Record<string, number> = {
  '91049124-4c27-4006-aefe-4aefe250682f': 1,
  '34437071-e24f-48f1-adf1-02205a4b8cf3': 2,
  '0e0d9e8e-4348-4ef2-a6d2-eac5f348aeb3': 3,
  '394ff21b-e38b-4c0e-80bf-60d844b5dae5': 4,
};
