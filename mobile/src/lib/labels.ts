import type { InvalidReason, PatrolMode, SessionStatus } from '../api/types';

export const REASON_LABELS: Record<InvalidReason, string> = {
  out_of_range: 'Fuera del rango del checkpoint',
  no_prior_movement: 'Sin movimiento previo al escaneo',
  duplicate: 'Checkpoint ya escaneado en esta ronda',
};

export const PATROL_MODE_LABELS: Record<PatrolMode, string> = {
  foot: 'A pie',
  vehicle: 'En vehículo',
};

export const STATUS_LABELS: Record<SessionStatus, string> = {
  in_progress: 'En curso',
  completed: 'Completada',
  abandoned: 'Abandonada',
};

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-EC', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
