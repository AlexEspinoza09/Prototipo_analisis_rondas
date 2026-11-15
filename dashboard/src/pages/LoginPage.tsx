import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';

import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Icon, type IconName } from '../components/Icon';
import { Alert } from '../components/ui';

const HIGHLIGHTS: { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'map',
    title: 'Trazabilidad de cada ronda',
    text: 'Trayectoria real frente a la ruta esperada, con tiempos por punto de control.',
  },
  {
    icon: 'alert',
    title: 'Detección automática de anomalías',
    text: 'Cada alerta conserva la evidencia que la originó para su verificación.',
  },
  {
    icon: 'activity',
    title: 'Indicadores de cumplimiento',
    text: 'Seguimiento del desempeño por guardia, ruta y período.',
  },
];

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
    <div className="flex min-h-screen bg-surface">
      <section className="hidden w-[46%] max-w-2xl flex-col justify-between bg-navy p-12 text-slate-300 lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-white">
            <Icon name="shield" size={22} />
          </div>
          <span className="text-base font-semibold text-white">Monitoreo de Rondas</span>
        </div>

        <div>
          <h1 className="max-w-md text-3xl font-semibold leading-tight tracking-tight text-white">
            Monitoreo Inteligente de Rondas de Seguridad
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-400">
            Plataforma de supervisión y control del cumplimiento de las rutas de vigilancia.
          </p>
          <ul className="mt-10 flex flex-col gap-6">
            {HIGHLIGHTS.map((item) => (
              <li key={item.title} className="flex gap-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-navy-3 text-white">
                  <Icon name={item.icon} />
                </div>
                <div>
                  <div className="text-sm font-medium text-white">{item.title}</div>
                  <div className="mt-0.5 max-w-sm text-sm text-slate-400">{item.text}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-slate-500">Acceso exclusivo para personal autorizado.</p>
      </section>

      <section className="flex flex-1 items-center justify-center bg-plane px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-white">
              <Icon name="shield" size={22} />
            </div>
            <span className="text-base font-semibold">Monitoreo de Rondas</span>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight">Iniciar sesión</h2>
          <p className="mb-6 mt-1.5 text-sm text-ink-2">
            Ingrese sus credenciales para acceder al panel de supervisión.
          </p>

          {error && <Alert>{error}</Alert>}

          <form onSubmit={onSubmit} className="card card-body flex flex-col gap-4">
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
                placeholder="usuario@organizacion.com"
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
            <button type="submit" disabled={busy} className="btn-primary mt-1 w-full py-2.5">
              {busy ? 'Verificando…' : 'Ingresar'}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-muted">
            Si no recuerda sus credenciales, comuníquese con el administrador del sistema.
          </p>
        </div>
      </section>
    </div>
  );
}
