import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';

import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icon';
import { Alert } from '../components/ui';

export function LoginPage() {
  const { user, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'El correo o la contraseña no son correctos.'
          : 'No fue posible conectar con el servidor. Intente nuevamente en unos minutos.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-plane">
      <header className="bg-navy">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-white">
            <Icon name="shield" size={20} />
          </div>
          <span className="text-sm font-semibold tracking-wide text-white">
            Monitoreo de Rondas
          </span>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-[420px]">
          <div className="overflow-hidden rounded-lg border border-grid bg-surface shadow-card">
            <div className="h-1 bg-primary" />
            <div className="px-8 pb-8 pt-7">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                Proyecto de análisis de rondas de seguridad
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
                Iniciar sesión
              </h1>
              <div className="mb-6 mt-5 border-t border-grid" />

              {error && <Alert>{error}</Alert>}

              <form onSubmit={onSubmit} className="flex flex-col gap-4">
                <div>
                  <label className="field-label" htmlFor="email">
                    Correo electrónico
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    autoComplete="username"
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input"
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="password">
                    Contraseña
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="input pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted hover:text-ink"
                      aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    >
                      <Icon name={showPassword ? 'eyeOff' : 'eye'} size={16} />
                    </button>
                  </div>
                </div>
                <button type="submit" disabled={busy} className="btn-primary mt-2 w-full py-2.5">
                  {busy ? 'Verificando…' : 'Ingresar'}
                </button>
              </form>
            </div>
            <div className="border-t border-grid bg-plane/60 px-8 py-3.5 text-center text-xs text-muted">
              Acceso restringido a personal autorizado.
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-grid bg-surface">
        <div className="mx-auto max-w-6xl px-6 py-4 text-center text-xs text-muted">
          © {new Date().getFullYear()} Monitoreo Inteligente de Rondas de Seguridad
        </div>
      </footer>
    </div>
  );
}
