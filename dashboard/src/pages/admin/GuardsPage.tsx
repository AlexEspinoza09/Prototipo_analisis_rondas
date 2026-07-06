import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { api, ApiError } from '../../api/client';
import type { Role, User } from '../../api/types';

const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrador',
  supervisor: 'Supervisor',
  guard: 'Guardia',
};

const EMPTY = { full_name: '', email: '', password: '', role: 'guard' as Role };

export function GuardsPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const users = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] });
  const onError = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : 'Error inesperado');

  const create = useMutation({
    mutationFn: (payload: typeof EMPTY) =>
      api<User>('/users', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => {
      invalidate();
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

  const inputClass = 'rounded border border-grid px-3 py-2 text-sm';

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Personal</h1>
      {error && <p className="mb-3 text-sm text-critical">{error}</p>}

      <form
        onSubmit={onSubmit}
        className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-grid bg-surface p-4"
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">Nombre completo</label>
          <input
            required
            className={inputClass}
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">Correo</label>
          <input
            required
            type="email"
            className={inputClass}
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">Contraseña (mín. 8)</label>
          <input
            required
            type="password"
            minLength={8}
            className={inputClass}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">Rol</label>
          <select
            className={inputClass}
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
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded bg-series px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
        >
          Crear usuario
        </button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-grid bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-grid text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3">Nombre</th>
              <th className="px-4 py-3">Correo</th>
              <th className="px-4 py-3">Rol</th>
              <th className="px-4 py-3">Activo</th>
              <th className="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {users.data?.map((user) => (
              <tr key={user.id} className="border-b border-grid/60 last:border-0">
                <td className="px-4 py-2.5">{user.full_name}</td>
                <td className="px-4 py-2.5">{user.email}</td>
                <td className="px-4 py-2.5">{ROLE_LABELS[user.role]}</td>
                <td className="px-4 py-2.5">{user.is_active ? 'Sí' : 'No'}</td>
                <td className="space-x-3 px-4 py-2.5 text-right text-xs">
                  <button
                    className="text-ink-2 hover:underline"
                    onClick={() => toggleActive.mutate(user)}
                  >
                    {user.is_active ? 'Desactivar' : 'Activar'}
                  </button>
                  <button
                    className="text-critical hover:underline"
                    onClick={() => {
                      if (confirm(`¿Eliminar a ${user.full_name}?`)) remove.mutate(user.id);
                    }}
                  >
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
