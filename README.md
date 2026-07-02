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

- API y documentación interactiva: http://localhost:8000/docs
- Health check: http://localhost:8000/health
- Health check de base de datos (incluye versión de PostGIS): http://localhost:8000/health/db

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
- ✅ **Etapa 2 — Core del backend**: auth JWT, sesiones, telemetría batch idempotente, escaneos con validación geográfica e inmovilidad, 19 tests.
- ⬜ Etapa 3 — Análisis asíncrono (Celery: desviación de ruta, patrón degradante)
- ⬜ Etapa 4 — Dashboard (React + MapLibre + Recharts)
- ⬜ Etapa 5 — App móvil (Expo)
