import type {
  AnomalyType,
  Role,
  InvalidReason,
  PatrolMode,
  SegmentVerdict,
  SessionStatus,
  Severity,
} from '../api/types';
import type { Tone } from '../components/ui';

export const ANOMALY_LABELS: Record<AnomalyType, string> = {
  fraudulent_scan: 'Escaneo fraudulento',
  route_deviation: 'Desviación de ruta',
  impossible_speed: 'Velocidad imposible',
  inactivity: 'Inactividad',
  performance_decline: 'Bajo desempeño',
  segment_too_fast: 'Tramo demasiado rápido',
  segment_too_slow: 'Tramo demasiado lento',
  out_of_sequence: 'Checkpoints fuera de orden',
  missed_checkpoint: 'Checkpoint no visitado',
  round_too_short: 'Ronda demasiado corta',
  round_too_long: 'Ronda demasiado larga',
  sensor_mismatch: 'Sensores incoherentes con el GPS',
  telemetry_gap: 'Pérdida de señal GPS',
  gps_jump: 'Salto de posición GPS',
};

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrador',
  supervisor: 'Supervisor',
  guard: 'Guardia',
};

export const PATROL_MODE_LABELS: Record<PatrolMode, string> = {
  foot: 'A pie',
  vehicle: 'En vehículo',
};

export const VERDICT_LABELS: Record<SegmentVerdict, string> = {
  ok: 'En tiempo',
  fast: 'Demasiado rápido',
  slow: 'Demasiado lento',
};

// Readable names for the evidence keys stored in anomaly details (JSONB).
export const DETAIL_LABELS: Record<string, string> = {
  scan_id: 'Escaneo',
  checkpoint_id: 'ID checkpoint',
  checkpoint_name: 'Checkpoint',
  distance_m: 'Distancia (m)',
  radius_m: 'Radio permitido (m)',
  patrol_mode: 'Modo de patrullaje',
  window_min: 'Ventana analizada (min)',
  points_in_window: 'Puntos en la ventana',
  avg_accel_magnitude: 'Aceleración media (m/s²)',
  still_ratio: 'Proporción sin movimiento',
  walk_accel_threshold_mps2: 'Umbral de caminata (m/s²)',
  inactivity_still_ratio: 'Umbral de inmovilidad',
  displacement_m: 'Desplazamiento GPS (m)',
  min_displacement_m: 'Desplazamiento mínimo (m)',
  frechet_distance_m: 'Distancia de Fréchet (m)',
  threshold_m: 'Umbral (m)',
  route_id: 'Ruta',
  point_count: 'Puntos GPS',
  gps_spikes_excluded: 'Saltos GPS excluidos',
  started_at: 'Inicio',
  ended_at: 'Fin',
  duration_s: 'Duración (s)',
  max_speed_mps: 'Velocidad máxima (m/s)',
  speed_limit_mps: 'Límite de velocidad (m/s)',
  min_duration_s: 'Duración mínima (s)',
  from_checkpoint: 'Desde',
  to_checkpoint: 'Hasta',
  expected_min: 'Esperado (min)',
  actual_min: 'Real (min)',
  ratio: 'Proporción real / esperado',
  fast_ratio: 'Umbral rápido',
  slow_ratio: 'Umbral lento',
  expected_order: 'Orden esperado',
  actual_order: 'Orden real',
  missed: 'No visitados',
  missed_count: 'Cantidad no visitados',
  route_checkpoints: 'Checkpoints de la ruta',
  expected_duration_min: 'Duración esperada (min)',
  actual_duration_min: 'Duración real (min)',
  short_ratio: 'Umbral corta',
  long_ratio: 'Umbral larga',
  total_duration_s: 'Duración total (s)',
  gps_distance_m: 'Distancia GPS (m)',
  stretches: 'Tramos',
  static_accel_std_mps2: 'Umbral de vibración (m/s²)',
  static_gyro_rad_s: 'Umbral de rotación (rad/s)',
  min_speed_mps: 'Velocidad mínima (m/s)',
  gap_count: 'Cantidad de cortes',
  total_gap_s: 'Tiempo sin señal (s)',
  gap_ratio: 'Proporción sin señal',
  gaps: 'Cortes',
  gap_threshold_s: 'Umbral de corte (s)',
  jump_count: 'Cantidad de saltos',
  precise_jump_count: 'Saltos con buena precisión',
  jumps: 'Saltos',
  min_distance_m: 'Distancia mínima (m)',
  jump_speed_mps: 'Velocidad de salto (m/s)',
  max_accuracy_m: 'Precisión máxima (m)',
  recent_window_days: 'Ventana reciente (días)',
  previous_window_days: 'Ventana anterior (días)',
  metrics: 'Métricas',
  max_decline: 'Caída máxima',
  threshold: 'Umbral',
  checkpoint: 'Checkpoint',
  sequence_order: 'Orden',
  out_of_range_attempts: 'Intentos fuera de rango',
  from: 'Desde',
  to: 'Hasta',
  at: 'Momento',
  kind: 'Tipo',
  accuracy_m: 'Precisión (m)',
  previous: 'Período anterior',
  recent: 'Período reciente',
  decline: 'Caída',
  rounds_per_day: 'Rondas por día',
  distance_m_per_day: 'Distancia por día (m)',
  active_min_per_day: 'Minutos activos por día',
};

export const JUMP_KIND_LABELS: Record<string, string> = {
  spike: 'Punto aislado',
  hop: 'Salto único',
};

export function formatDateTimeSeconds(iso: string): string {
  return new Date(iso).toLocaleString('es-EC', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export const SEVERITY_LABELS: Record<Severity, string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
};

export const SEVERITY_TONE: Record<Severity, Tone> = {
  low: 'neutral',
  medium: 'warning',
  high: 'critical',
};

export const STATUS_LABELS: Record<SessionStatus, string> = {
  in_progress: 'En curso',
  completed: 'Completada',
  abandoned: 'Abandonada',
};

export const REASON_LABELS: Record<InvalidReason, string> = {
  out_of_range: 'Fuera de rango',
  no_prior_movement: 'Sin movimiento previo',
  duplicate: 'Duplicado',
};

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-EC', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDay(isoDate: string): string {
  const [, month, day] = isoDate.split('-');
  return `${day}/${month}`;
}
