export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface User {
  id: number;
  full_name: string;
  email: string;
  role: 'admin' | 'supervisor' | 'guard';
  is_active: boolean;
}

export interface RouteCheckpoint {
  checkpoint_id: number;
  name: string;
  sequence_order: number;
  expected_offset_min: number;
  lat: number;
  lng: number;
  radius_m: number;
}

export interface RouteItem {
  id: number;
  site_id: number;
  name: string;
  expected_duration_min: number;
  is_active: boolean;
  path: [number, number][] | null;
  checkpoints: RouteCheckpoint[];
}

export type SessionStatus = 'in_progress' | 'completed' | 'abandoned';

export interface PatrolSession {
  id: number;
  guard_id: number;
  route_id: number;
  started_at: string;
  ended_at: string | null;
  status: SessionStatus;
  device_id: string;
}

export interface SessionListItem extends PatrolSession {
  guard_name: string;
  route_name: string;
}

export type InvalidReason = 'out_of_range' | 'no_prior_movement' | 'duplicate';

export interface ScanResult {
  id: number;
  checkpoint_id: number;
  checkpoint_name: string;
  scanned_at: string;
  is_valid: boolean;
  invalid_reason: InvalidReason | null;
  distance_to_checkpoint_m: number;
  radius_m: number;
}
