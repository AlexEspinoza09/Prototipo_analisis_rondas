export type Role = 'admin' | 'supervisor' | 'guard';

export interface User {
  id: number;
  full_name: string;
  email: string;
  role: Role;
  is_active: boolean;
  created_at: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export type SessionStatus = 'in_progress' | 'completed' | 'abandoned';

export interface SessionListItem {
  id: number;
  guard_id: number;
  route_id: number;
  started_at: string;
  ended_at: string | null;
  status: SessionStatus;
  device_id: string;
  guard_name: string;
  route_name: string;
}

export interface TrackFeature {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: [number, number][] } | null;
  properties: {
    session_id: number;
    guard_id: number;
    route_id: number;
    status: SessionStatus;
    started_at: string;
    ended_at: string | null;
    point_count: number;
  };
}

export type InvalidReason = 'out_of_range' | 'no_prior_movement' | 'duplicate';

export interface SessionScan {
  id: number;
  checkpoint_id: number;
  checkpoint_name: string;
  scanned_at: string;
  is_valid: boolean;
  invalid_reason: InvalidReason | null;
  distance_to_checkpoint_m: number;
}

export interface Site {
  id: number;
  name: string;
  address: string | null;
}

export interface Checkpoint {
  id: number;
  site_id: number;
  name: string;
  qr_code: string;
  lat: number;
  lng: number;
  radius_m: number;
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

export type AnomalyType =
  | 'fraudulent_scan'
  | 'route_deviation'
  | 'impossible_speed'
  | 'inactivity'
  | 'performance_decline';

export type Severity = 'low' | 'medium' | 'high';

export interface Anomaly {
  id: number;
  session_id: number | null;
  guard_id: number;
  guard_name: string;
  type: AnomalyType;
  severity: Severity;
  detected_at: string;
  details: Record<string, unknown>;
  reviewed: boolean;
}

export interface Summary {
  window_days: number;
  totals: {
    sessions_today: number;
    sessions_7d: number;
    valid_scan_pct_7d: number | null;
    open_anomalies: number;
  };
  sessions_per_day: { date: string; count: number }[];
  scans_per_day: { date: string; valid: number; invalid: number }[];
  anomalies_by_type: { type: AnomalyType; count: number }[];
  guard_activity: {
    guard_id: number;
    guard_name: string;
    sessions_7d: number;
    valid_scan_pct_7d: number | null;
    anomalies_7d: number;
  }[];
}
