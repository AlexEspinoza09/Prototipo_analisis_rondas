import type { AnomalyType, InvalidReason, SessionStatus, Severity } from '../api/types';

export const ANOMALY_LABELS: Record<AnomalyType, string> = {
  fraudulent_scan: 'Escaneo fraudulento',
  route_deviation: 'Desviación de ruta',
  impossible_speed: 'Velocidad imposible',
  inactivity: 'Inactividad',
  performance_decline: 'Bajo desempeño',
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
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
