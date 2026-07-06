import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';

import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';

export function LoginPage() {
  const { user, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'Credenciales incorrectas'
          : 'No se pudo iniciar sesión. ¿El servidor está arriba?',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-lg border border-grid bg-surface p-8 shadow-sm"
      >
        <h1 className="text-xl font-semibold">Protemaxi</h1>
        <p className="mb-6 text-sm text-muted">Sistema de monitoreo de rondas</p>
        <label className="mb-1 block text-sm text-ink-2" htmlFor="email">
          Correo
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full rounded border border-grid px-3 py-2 text-sm"
          placeholder="admin@protemaxi.ec"
        />
        <label className="mb-1 block text-sm text-ink-2" htmlFor="password">
          Contraseña
        </label>
        <input
          id="password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-4 w-full rounded border border-grid px-3 py-2 text-sm"
        />
        {error && <p className="mb-4 text-sm text-critical">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-series px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </div>
  );
}
