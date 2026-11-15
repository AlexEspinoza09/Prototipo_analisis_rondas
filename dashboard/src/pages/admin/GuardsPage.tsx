import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { api, ApiError } from '../../api/client';
import type { Role, User } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { Icon } from '../../components/Icon';
import {
  ActiveBadge,
  Alert,
  Badge,
  PageHeader,
  TableMessage,
  useConfirm,
  type Tone,
} from '../../components/ui';
import { ROLE_LABELS } from '../../lib/labels';

const ROLE_TONE: Record<Role, Tone> = { admin: 'info', supervisor: 'info', guard: 'neutral' };

const EMPTY = { full_name: '', email: '', password: '', role: 'guard' as Role };

export function GuardsPage() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const users = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] });
  const onError = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : 'Ocurrió un error inesperado.');

  const create = useMutation({
    mutationFn: (payload: typeof EMPTY) =>
      api<User>('/users', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => {
      void invalidate();
      setForm(EMPTY);
      setError(null);
    },
    onError,
  });

  const toggleActive = useMutation({
    mutationFn: (user: User) =>
      api<User>(`/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !user.is_active }),
      }),
    onSuccess: invalidate,
    onError,
  });

  const remove = useMutation({
    mutationFn: (id: number) => api<void>(`/users/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError,
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(form);
  };

  return (
    <div>
      <PageHeader
        title="Personal"
        description="Usuarios del sistema: guardias de la aplicación móvil, supervisores y administradores del panel."
      />
      {error && <Alert onClose={() => setError(null)}>{error}</Alert>}

      <form onSubmit={onSubmit} className="card mb-5">
        <div className="card-header">
          <h2 className="card-title">Nuevo usuario</h2>
        </div>
        <div className="card-body grid gap-4 sm:grid-cols-2 xl:grid-cols-[1.2fr_1.2fr_1fr_0.8fr_auto] xl:items-end">
          <div>
            <label className="field-label" htmlFor="user-name">
              Nombre completo
            </label>
            <input
              id="user-name"
              required
              className="input"
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="user-email">
              Correo electrónico
            </label>
            <input
              id="user-email"
              required
              type="email"
              className="input"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="user-password">
              Contraseña (mínimo 8 caracteres)
            </label>
            <input
              id="user-password"
              required
              type="password"
              minLength={8}
              autoComplete="new-password"
              className="input"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="user-role">
              Rol
            </label>
            <select
              id="user-role"
              className="input"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            >
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={create.isPending} className="btn-primary">
            <Icon name="plus" size={16} />
            Crear usuario
          </button>
        </div>
      </form>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Usuarios registrados</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Correo electrónico</th>
                <th>Rol</th>
                <th>Estado</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users.data?.map((user) => (
                <tr key={user.id} className="row-hover">
                  <td className="font-medium">{user.full_name}</td>
                  <td className="text-ink-2">{user.email}</td>
                  <td>
                    <Badge tone={ROLE_TONE[user.role]}>{ROLE_LABELS[user.role]}</Badge>
                  </td>
                  <td>
                    <ActiveBadge active={user.is_active} />
                  </td>
                  <td className="space-x-4 text-right">
                    {user.id === currentUser?.id ? (
                      <span className="text-xs text-muted">Su cuenta</span>
                    ) : (
                      <>
                        <button
                          className="link-action-muted"
                          onClick={() => toggleActive.mutate(user)}
                        >
                          {user.is_active ? 'Desactivar' : 'Activar'}
                        </button>
                        <button
                          className="link-action-danger"
                          onClick={() =>
                            confirm({
                              title: 'Eliminar usuario',
                              message: `Se eliminará la cuenta de ${user.full_name}. Esta acción no se puede deshacer.`,
                              confirmLabel: 'Eliminar',
                              danger: true,
                              onConfirm: () => remove.mutate(user.id),
                            })
                          }
                        >
                          Eliminar
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {users.isLoading && <TableMessage colSpan={5}>Cargando usuarios…</TableMessage>}
            </tbody>
          </table>
        </div>
        {users.data && <div className="table-footer">{users.data.length} usuarios</div>}
      </div>
      {confirmDialog}
    </div>
  );
}
