# Monitoreo Inteligente de Rondas de Seguridad

Prototipo de tesis: sistema web de monitoreo inteligente que detecta anomalías y posibles fraudes operativos en las rondas de guardias de seguridad, a partir de la trayectoria, los tiempos entre puntos de control y el comportamiento sensorial del teléfono (GPS, acelerómetro, giróscopo), junto con el escaneo de códigos QR en los checkpoints.

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

# 3. Cargar datos de desarrollo (admin, 2 guardias, 1 instalación de demostración con 4 checkpoints y 1 ruta)
docker compose exec api python -m app.seeds

# 4. (Opcional) Generar 2 semanas de rondas sintéticas con escenarios de fraude controlados
docker compose exec api python -m app.demo_data
```

Las migraciones de Alembic se aplican automáticamente al arrancar el servicio `api`.

### Verificar que todo funciona

- **Dashboard web**: http://localhost:5173 (login: `admin@rondas.demo / Admin123!`)
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
| Admin | admin@rondas.demo | Admin123! |
| Guardia | guardia1@rondas.demo | Guardia123! |
| Guardia | guardia2@rondas.demo | Guardia123! |

El dominio `.demo` es ficticio a propósito (dominios reservados como `.local` o `.test` los rechaza el validador de email).

El script de seeds imprime los UUID de los códigos QR de los 4 checkpoints al ejecutarse.

## Dashboard (Etapa 4)

En http://localhost:5173, solo para roles `admin` y `supervisor`. La interfaz usa un sistema de diseño propio (tokens en [dashboard/tailwind.config.js](dashboard/tailwind.config.js), estilos base en [dashboard/src/index.css](dashboard/src/index.css) y componentes en [dashboard/src/components/](dashboard/src/components/)):

- **Mapa de rondas**: selector de sesión; trayectoria real (azul) vs. ruta esperada (gris punteada); checkpoints numerados y coloreados por estado del escaneo (verde válido, rojo inválido, gris no visitado); lista de escaneos de la sesión; **tiempos de la ronda** (minuto esperado vs. real de cada checkpoint y veredicto de cada tramo: en tiempo, demasiado rápido o demasiado lento) y **anomalías de la sesión**.
- **Anomalías**: filtros por tipo, severidad, estado y guardia; filas expandibles con la evidencia JSONB legible; marcar revisada/pendiente.
- **Panel general** (pantalla de inicio): rondas hoy/7 días, % escaneos válidos, anomalías abiertas; gráficas de rondas por día, escaneos válidos vs. inválidos y anomalías por tipo; tabla de actividad por guardia.
- **Administración**: checkpoints (clic en el mapa para ubicar, radio configurable, QR imprimible), rutas (trazo dibujado con clics + asignación ordenada de checkpoints con offsets + **modo de patrullaje**: a pie o en vehículo), personal (crear usuarios, activar/desactivar, eliminar).

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
| GET | `/sessions/{id}/timeline` | Minuto esperado vs. real de cada checkpoint y veredicto de cada tramo (regla 5) |
| GET | `/sessions` | Lista sesiones (admin/supervisor) |
| POST | `/telemetry/batch` | Ingesta bulk idempotente de puntos GPS/sensores (`accel_magnitude`, `accel_std`, `gyro_magnitude`, `is_moving` opcionales) |
| POST | `/scans` | Registra escaneo QR y valida en línea (reglas 1 y 2) |

Reglas de negocio implementadas en `/scans`:

1. **Validación geográfica**: si `ST_Distance(scan, checkpoint) > radius_m` → escaneo inválido (`out_of_range`) + anomalía `fraudulent_scan` con severidad según la distancia (configurable vía `FRAUD_SEVERITY_*_RATIO`).
2. **Inmovilidad previa**: si en los 5 minutos previos el promedio de `accel_magnitude` está bajo el umbral de caminata o `is_moving=false` en >80% de los puntos → escaneo inválido (`no_prior_movement`) + anomalía `inactivity`. Sin telemetría en la ventana, la regla se difiere. En rutas **en vehículo** un trayecto suave da poca aceleración, así que además se exige que el GPS se haya desplazado menos de `INACTIVITY_VEHICLE_MIN_DISPLACEMENT_M` (50 m).

Un segundo escaneo del mismo checkpoint en la misma sesión se marca `duplicate` (sin anomalía).

## Análisis asíncrono (Etapa 3)

Al cerrar una sesión, `POST /sessions/{id}/end` encola la tarea `analyze_session` en el worker de Celery, que ejecuta las reglas 3, 5, 6 y 7 sobre la ronda completa:

3. **Desviación de ruta**: se construye la trayectoria real (`ST_MakeLine` de la telemetría, sin los saltos GPS aislados de la regla 7) y se compara contra `routes.expected_path` con `ST_FrechetDistance`, proyectando ambas a UTM 17S (`PROJECTION_SRID=32717`) para medir en metros. Si supera `ROUTE_FRECHET_THRESHOLD_M` (100 m) → anomalía `route_deviation` (`high` si ≥ 2× el umbral).
   Además se detectan **velocidades imposibles**: rachas de velocidad implícita entre puntos consecutivos sobre el límite del modo de patrullaje (`IMPOSSIBLE_SPEED_MPS` = 3.5 m/s a pie, `IMPOSSIBLE_SPEED_VEHICLE_MPS` = 16.7 m/s ≈ 60 km/h en vehículo) sostenidas ≥ `IMPOSSIBLE_SPEED_MIN_DURATION_S` (30 s) → anomalía `impossible_speed` por racha.
4. **Patrón degradante**: Celery Beat ejecuta `nightly_performance_analysis` cada día a las 03:00 (America/Guayaquil). Por guardia compara los últimos 7 días vs. los 21 anteriores en rondas/día, distancia/día y minutos activos/día; caída > `PERFORMANCE_DECLINE_RATIO` (30%) → anomalía `performance_decline` (severidad según magnitud). Idempotente por guardia y día.

5. **Tiempos y orden entre checkpoints**: con el primer escaneo dentro del radio de cada checkpoint (presencia física) se reconstruye la línea de tiempo de la ronda y se compara con `route_checkpoints.expected_offset_min`:
   - `segment_too_fast` / `segment_too_slow`: un tramo entre checkpoints consecutivos tomó menos de `SEGMENT_FAST_RATIO` (50%) o más de `SEGMENT_SLOW_RATIO` (200%) del tiempo esperado, con una diferencia de al menos `SEGMENT_MIN_DELTA_MIN` (2 min) para absorber el ruido en tramos cortos.
   - `out_of_sequence`: los checkpoints se visitaron en un orden distinto al de la ruta (los tramos invertidos no se cronometran).
   - `missed_checkpoint`: checkpoints sin ningún escaneo dentro del radio (cuenta los intentos fuera de rango).
   - `round_too_short` / `round_too_long`: la duración total quedó bajo `ROUND_SHORT_RATIO` (50%) o sobre `ROUND_LONG_RATIO` (150%) de `routes.expected_duration_min`.
6. **Coherencia de sensores** (`sensor_mismatch`): el GPS indica desplazamiento (≥ `SENSOR_MISMATCH_MIN_SPEED_MPS`, 0.8 m/s) mientras el teléfono no vibra ni rota (desviación estándar de la aceleración < `STATIC_ACCEL_STD_MPS2` y giro medio < `STATIC_GYRO_RAD_S`) durante ≥ `SENSOR_MISMATCH_MIN_DURATION_S` (60 s). Es el patrón de un GPS simulado o de un teléfono que no lleva el guardia.
7. **Calidad de la señal GPS**:
   - `telemetry_gap`: periodos sin telemetría mayores a `TELEMETRY_GAP_S` (120 s), incluidos el inicio y el final de la sesión (GPS apagado o app cerrada). Severidad según la proporción de la ronda sin señal.
   - `gps_jump`: saltos instantáneos ≥ `GPS_JUMP_MIN_DISTANCE_M` (100 m) a más de `GPS_JUMP_SPEED_FACTOR` (2×) el límite de velocidad, ya sea un punto aislado que va y vuelve (*spike*) o un salto único. Con buena precisión (≤ 50 m) es `high` (posible suplantación de ubicación); con mala precisión, `low` (ruido GPS).

Todas las tareas son idempotentes (re-ejecutarlas no duplica anomalías). Todos los umbrales están en [backend/.env.example](backend/.env.example).

### Evaluación en entorno controlado

`python -m app.demo_data` genera dos semanas de rondas sintéticas (28 sesiones, menos las que aún no ocurren hoy) con ruido GPS realista y lecturas de sensores, e inyecta un escenario controlado por cada tipo de fraude o anomalía: ronda apresurada, orden invertido, GPS apagado, salto GPS, pausa larga, teléfono inmóvil con GPS en movimiento, tramo en vehículo, desvío, escaneo suplantado e inactividad previa. Al terminar imprime una matriz que compara, por sesión, las anomalías esperadas con las detectadas (verdaderos/falsos positivos, falsos negativos, precisión y *recall*), útil como evidencia de la evaluación del sistema.

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

Nota: la tabla `telemetry_points` está particionada por mes sobre `recorded_at`. La migración inicial crea particiones para los próximos 12 meses más una partición `DEFAULT`. La migración `0002_patrol_analysis` añade el modo de patrullaje de las rutas, las columnas `accel_std` y `gyro_magnitude` de la telemetría y los nuevos tipos de anomalía.

## Estado del proyecto

- ✅ **Etapa 1 — Fundación**: monorepo, Docker Compose, esqueleto FastAPI, esquema completo con Alembic, seeds.
- ✅ **Etapa 2 — Core del backend**: auth JWT, sesiones, telemetría batch idempotente, escaneos con validación geográfica e inmovilidad.
- ✅ **Etapa 3 — Análisis asíncrono**: desviación de ruta (Fréchet), velocidades imposibles y patrón degradante nocturno con Celery + Beat.
- ✅ **Etapa 4 — Dashboard**: mapa de sesiones (trayectoria real vs. esperada, checkpoints coloreados), tabla de anomalías con evidencia expandible, KPIs con Recharts y administración (checkpoints con QR imprimible, rutas dibujadas sobre el mapa, personal).
- ✅ **Etapa 5 — App móvil**: Expo (development build) con GPS en background + buffer SQLite + sincronización con backoff, escaneo QR con validación de señal y feedback inmediato, historial. Ver [mobile/README.md](mobile/README.md) para generar el dev build y el APK con EAS.
- ✅ **Ampliación del análisis**: tiempos y orden entre checkpoints (regla 5), giróscopo y variabilidad de la aceleración con detección de incoherencia sensores/GPS (regla 6), calidad de señal GPS (regla 7), modo de patrullaje a pie/vehículo, línea de tiempo de la ronda en el dashboard y matriz de evaluación con escenarios controlados. 50 tests backend.
