import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { Icon } from './Icon';

/** Page title block: title, one-line description and optional actions. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export type Tone = 'neutral' | 'info' | 'good' | 'warning' | 'critical';

const BADGE_TONE: Record<Tone, string> = {
  neutral: 'bg-plane text-ink-2 ring-grid',
  info: 'bg-primary-soft text-primary ring-primary/20',
  good: 'bg-good/10 text-good-ink ring-good/25',
  warning: 'bg-warning/15 text-warning-ink ring-warning/40',
  critical: 'bg-critical/10 text-critical-ink ring-critical/25',
};

const DOT_TONE: Record<Tone, string> = {
  neutral: 'bg-muted',
  info: 'bg-primary',
  good: 'bg-good',
  warning: 'bg-warning',
  critical: 'bg-critical',
};

/** Status label: a dot plus text, so state is never encoded by color alone. */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE_TONE[tone]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT_TONE[tone]}`} aria-hidden />
      {children}
    </span>
  );
}

export function ActiveBadge({ active }: { active: boolean }) {
  return <Badge tone={active ? 'good' : 'neutral'}>{active ? 'Activo' : 'Inactivo'}</Badge>;
}

export function Alert({
  tone = 'critical',
  children,
  onClose,
}: {
  tone?: 'critical' | 'info' | 'warning';
  children: ReactNode;
  onClose?: () => void;
}) {
  const style = {
    critical: 'border-critical/30 bg-critical/5 text-critical-ink',
    warning: 'border-warning/50 bg-warning/10 text-warning-ink',
    info: 'border-primary/20 bg-primary-soft text-primary',
  }[tone];
  return (
    <div role="alert" className={`mb-4 flex items-start gap-2 rounded-md border px-3.5 py-2.5 text-sm ${style}`}>
      <Icon name={tone === 'info' ? 'info' : 'alert'} size={16} className="mt-0.5" />
      <div className="min-w-0 flex-1">{children}</div>
      {onClose && (
        <button onClick={onClose} aria-label="Cerrar aviso" className="rounded p-0.5 hover:bg-black/5">
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}

export function Spinner({ label = 'Cargando…' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-grid border-t-primary" />
      {label}
    </span>
  );
}

/** Table body placeholder for loading and empty states. */
export function TableMessage({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="!py-10 text-center text-sm text-muted">
        {children}
      </td>
    </tr>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy/50 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-lg bg-surface shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-grid px-5 py-3.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Cerrar" className="rounded p-1 text-muted hover:bg-plane">
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-grid bg-plane/60 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}

/** In-app replacement for window.confirm: returns [ask, dialogElement]. */
export function useConfirm(): [(options: ConfirmOptions) => void, ReactNode] {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const close = useCallback(() => setOptions(null), []);

  const dialog = options ? (
    <Modal
      title={options.title}
      onClose={close}
      footer={
        <>
          <button className="btn-secondary" onClick={close}>
            Cancelar
          </button>
          <button
            autoFocus
            className={options.danger ? 'btn-danger' : 'btn-primary'}
            onClick={() => {
              options.onConfirm();
              close();
            }}
          >
            {options.confirmLabel ?? 'Confirmar'}
          </button>
        </>
      }
    >
      <p className="text-sm text-ink-2">{options.message}</p>
    </Modal>
  ) : null;

  return [setOptions, dialog];
}
