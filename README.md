# Sistema de Monitoreo Inteligente de Rondas de Seguridad

Prototipo de tesis para Protemaxi (Ecuador): detección de fraude y anomalías en rondas de guardias de seguridad usando telemetría del teléfono (GPS, acelerómetro) y escaneo de códigos QR en checkpoints.

## Arquitectura

| Servicio | Tecnología | Puerto |
|---|---|---|
| `api` | FastAPI + SQLAlchemy 2 + GeoAlchemy2 | 8000 |
| `worker` | Celery (análisis de rutas y patrones) | — |
| `beat` | Celery Beat (tareas nocturnas) | — |
| `postgres` | PostgreSQL 16 + PostGIS 3.4 | 5432 |
| `redis` | Redis 7 (broker de Celery) | 6379 |
| `dashboard` | React 18 + Vite + MapLibre + Recharts | 5173 |

```
.
├── backend/      # FastAPI + Celery + Alembic
├── dashboard/    # React + Vite (Etapa 4)
└── mobile/       # Expo / React Native (Etapa 5)
```

## Requisitos

- Docker Desktop (con Docker Compose v2). Nada más: todo corre en contenedores.

## Arranque

```bash
# 1. Crear el archivo de entorno del backend
cp backend/.env.example backend/.env

# 2. Levantar todo (la primera vez tarda varios minutos: descarga imágenes e instala dependencias)
docker compose up --build -d

# 3. Cargar datos de desarrollo (admin, 2 guardias, 1 site en Quito con 4 checkpoints y 1 ruta)
docker compose exec api python -m app.seeds
```

Las migraciones de Alembic se aplican automáticamente al arrancar el servicio `api`.

### Verificar que todo funciona

- **Dashboard web**: http://localhost:5173 (login: `admin@protemaxi.ec / Admin123!`)
- API y documentación interactiva: http://localhost:8000/docs
- Health check: http://localhost:8000/health
- Health check de base de datos (incluye versión de PostGIS): http://localhost:8000/health/db

La primera vez el servicio `dashboard` ejecuta `npm install` dentro del contenedor (tarda unos minutos); las siguientes veces arranca directo.

```bash
# Logs de un servicio
docker compose logs -f api

# Ejecutar los tests (usan una BD separada rondas_test con PostGIS real)
docker compose exec api pytest

# Consola de PostgreSQL
docker compose exec postgres psql -U rondas -d rondas
```

## Credenciales de desarrollo (seeds)

| Rol | Email | Contraseña |
|---|---|---|
| Admin | admin@protemaxi.ec | Admin123! |
| Guardia | guardia1@protemaxi.ec | Guardia123! |
| Guardia | guardia2@protemaxi.ec | Guardia123! |

El script de seeds imprime los UUID de los códigos QR de los 4 checkpoints al ejecutarse.

## Dashboard (Etapa 4)

En http://localhost:5173, solo para roles `admin` y `supervisor`:

- **Mapa de rondas**: selector de sesión; trayectoria real (azul) vs. ruta esperada (gris punteada); checkpoints numerados y coloreados por estado del escaneo (verde válido, rojo inválido, gris no visitado); lista de escaneos de la sesión.
- **Anomalías**: filtros por tipo, severidad, estado y guardia; filas expandibles con la evidencia JSONB legible; marcar revisada/pendiente.
- **KPIs**: rondas hoy/7 días, % escaneos válidos, anomalías abiertas; gráficas de rondas por día, escaneos válidos vs. inválidos y anomalías por tipo; tabla de actividad por guardia.
- **Administración**: checkpoints (clic en el mapa para ubicar, radio configurable, QR imprimible), rutas (trazo dibujado con clics + asignación ordenada de checkpoints con offsets), personal (crear usuarios, activar/desactivar, eliminar).

Endpoints añadidos en esta etapa: `GET/PATCH /anomalies`, `GET /dashboard/summary`, `GET /auth/me`, `GET /sessions/{id}/scans`, y CRUD de `/sites`, `/checkpoints`, `/routes`, `/users`.

## API (Etapa 2)

Todos los endpoints (salvo login/refresh y health) requieren `Authorization: Bearer <access_token>`.

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/auth/login` | `{email, password}` → access + refresh token |
| POST | `/auth/refresh` | `{refresh_token}` → nuevo par de tokens |
| POST | `/sessions/start` | Guardia inicia ronda: `{route_id, device_id}` (409 si ya tiene una en curso) |
| POST | `/sessions/{id}/end` | Cierra la ronda (status `completed`) |
| GET | `/sessions/{id}/track` | GeoJSON Feature (LineString) de la trayectoria |
| GET | `/sessions` | Lista sesiones (admin/supervisor) |
| POST | `/telemetry/batch` | Ingesta bulk idempotente de puntos GPS/sensores |
| POST | `/scans` | Registra escaneo QR y valida en línea (reglas 1 y 2) |

Reglas de negocio implementadas en `/scans`:

1. **Validación geográfica**: si `ST_Distance(scan, checkpoint) > radius_m` → escaneo inválido (`out_of_range`) + anomalía `fraudulent_scan` con severidad según la distancia (configurable vía `FRAUD_SEVERITY_*_RATIO`).
2. **Inmovilidad previa**: si en los 5 minutos previos el promedio de `accel_magnitude` está bajo el umbral de caminata o `is_moving=false` en >80% de los puntos → escaneo inválido (`no_prior_movement`) + anomalía `inactivity`. Sin telemetría en la ventana, la regla se difiere.

Un segundo escaneo del mismo checkpoint en la misma sesión se marca `duplicate` (sin anomalía).

## Análisis asíncrono (Etapa 3)

Al cerrar una sesión, `POST /sessions/{id}/end` encola la tarea `analyze_session_route` en el worker de Celery:

3. **Desviación de ruta**: se construye la trayectoria real (`ST_MakeLine` de la telemetría) y se compara contra `routes.expected_path` con `ST_FrechetDistance`, proyectando ambas a UTM 17S (`PROJECTION_SRID=32717`) para medir en metros. Si supera `ROUTE_FRECHET_THRESHOLD_M` (100 m) → anomalía `route_deviation` (`high` si ≥ 2× el umbral).
   Además se detectan **velocidades imposibles**: rachas de velocidad implícita entre puntos consecutivos > `IMPOSSIBLE_SPEED_MPS` (3.5 m/s) sostenidas ≥ `IMPOSSIBLE_SPEED_MIN_DURATION_S` (30 s) → anomalía `impossible_speed` por racha.
4. **Patrón degradante**: Celery Beat ejecuta `nightly_performance_analysis` cada día a las 03:00 (America/Guayaquil). Por guardia compara los últimos 7 días vs. los 21 anteriores en rondas/día, distancia/día y minutos activos/día; caída > `PERFORMANCE_DECLINE_RATIO` (30%) → anomalía `performance_decline` (severidad según magnitud). Idempotente por guardia y día.

Ambas tareas son idempotentes (re-ejecutarlas no duplica anomalías).

```bash
# Disparar manualmente el análisis nocturno
docker compose exec worker celery -A app.tasks.celery_app:celery_app call app.tasks.nightly_performance_analysis
```

## App móvil (Etapa 5)

En [mobile/](mobile/): app Expo para los guardias (login, rutas, ronda activa con mapa MapLibre, escáner QR con feedback verde/rojo, historial). Requiere *development build* (no Expo Go); instrucciones completas de EAS en [mobile/README.md](mobile/README.md):

```bash
cd mobile && npm install && cp .env.example .env
eas build --profile development --platform android   # dev build
eas build --profile preview --platform android       # APK para distribuir
```

## Migraciones

```bash
# Crear una nueva migración (autogenerada a partir de los modelos)
docker compose exec api alembic revision --autogenerate -m "descripcion"

# Aplicar migraciones manualmente
docker compose exec api alembic upgrade head
```

Nota: la tabla `telemetry_points` está particionada por mes sobre `recorded_at`. La migración inicial crea particiones para los próximos 12 meses más una partición `DEFAULT`.

## Estado del proyecto

- ✅ **Etapa 1 — Fundación**: monorepo, Docker Compose, esqueleto FastAPI, esquema completo con Alembic, seeds.
- ✅ **Etapa 2 — Core del backend**: auth JWT, sesiones, telemetría batch idempotente, escaneos con validación geográfica e inmovilidad.
- ✅ **Etapa 3 — Análisis asíncrono**: desviación de ruta (Fréchet), velocidades imposibles y patrón degradante nocturno con Celery + Beat.
- ✅ **Etapa 4 — Dashboard**: mapa de sesiones (trayectoria real vs. esperada, checkpoints coloreados), tabla de anomalías con evidencia expandible, KPIs con Recharts y administración (checkpoints con QR imprimible, rutas dibujadas sobre el mapa, personal).
- ✅ **Etapa 5 — App móvil**: Expo (development build) con GPS en background + buffer SQLite + sincronización con backoff, escaneo QR con validación de señal y feedback inmediato, historial. Ver [mobile/README.md](mobile/README.md) para generar el dev build y el APK con EAS. 33 tests backend.
