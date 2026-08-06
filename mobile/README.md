# App móvil — Rondas Protemaxi

App Android para guardias: inicia rondas, registra GPS en segundo plano, muestrea el acelerómetro, guarda todo en SQLite local, sincroniza por lotes con reintentos y escanea los QR de los checkpoints con validación inmediata.

> **Importante:** esta app usa módulos nativos (ubicación en background, cámara, MapLibre), por lo que **NO funciona en Expo Go**. Necesitas un *development build*.

## Requisitos

- Node 20+ y una cuenta gratuita en https://expo.dev
- `npm install -g eas-cli`
- El backend corriendo (`docker compose up -d` en la raíz del repo)

## Configuración

```bash
cd mobile
npm install
cp .env.example .env
```

Edita `.env`:

- **Emulador Android**: `EXPO_PUBLIC_API_URL=http://10.0.2.2:8000`
- **Teléfono real** (misma red Wi-Fi que tu PC): `EXPO_PUBLIC_API_URL=http://<IP-de-tu-PC>:8000` (averíguala con `ipconfig`).

## Development build (desarrollo diario)

```bash
eas login                # una sola vez
eas build:configure      # una sola vez, vincula el proyecto

# Compila el dev client en la nube de Expo (gratis) y genera un APK instalable
eas build --profile development --platform android
```

Al terminar, EAS te da un enlace/QR: instala ese APK en el teléfono. Luego:

```bash
npm run start            # levanta el bundler (expo start --dev-client)
```

Abre la app instalada y conéctate al bundler (mismo Wi-Fi, o `--tunnel`).

Alternativa 100% local (sin EAS, requiere Android Studio + SDK):

```bash
npx expo run:android
```

## APK de distribución (entregar a la empresa)

```bash
eas build --profile preview --platform android
```

Genera un APK autocontenido (perfil `preview` de [eas.json](eas.json), `buildType: apk`) que se instala directo en los teléfonos de la empresa — sin Play Store. Recuerda compilarlo con la URL del backend definitiva en `.env` (las variables `EXPO_PUBLIC_*` se hornean en el build).

## Cómo funciona (resumen técnico)

- **Tracking**: al iniciar ronda se llama `POST /sessions/start` y se arranca `expo-location` con `expo-task-manager` ([src/tracking/locationTask.ts](src/tracking/locationTask.ts)): GPS cada 15 s con *foreground service* (notificación persistente). Cada punto se guarda primero en SQLite (`telemetry_buffer`, único por sesión+timestamp).
- **Sensores inerciales** ([src/tracking/sensors.ts](src/tracking/sensors.ts)): por cada fix de GPS se muestrea una ventana de 5 s a ~20 Hz de **acelerómetro** (desviación de la gravedad, m/s²) y **giroscopio** (velocidad angular, rad/s). El muestreo ocurre *dentro* del task de ubicación, en contexto headless: el foreground service mantiene la app habilitada para leer sensores bajo las restricciones de Android 9+, así que sigue registrando con la pantalla apagada. Si un sensor no existe en el dispositivo, sus features quedan en `null` sin afectar al otro.
- **Features por ventana** (para reconocimiento de actividad): de cada serie no se guardan las muestras crudas — a 20 Hz un turno de 8 h serían ~576k filas por sensor — sino media, desviación estándar, máximo, **frecuencia dominante** en la banda 0.5–5 Hz y **ratio de pico** (qué fracción de la potencia de la banda está en esa frecuencia). La media sola no separa caminar de ir en vehículo; lo que los separa es la dispersión y el ritmo: caminar tiene una cadencia periódica en 1.5–2.5 Hz con ratio de pico alto, mientras que la vibración de un vehículo es de banda ancha. El espectro se calcula con una DFT directa sobre ~46 frecuencias candidatas, sin dependencias externas. Se guarda también `sensor_sample_count`, porque Android limita la tasa de entrega según fabricante y la frecuencia real hay que medirla, no asumirla.
- **`is_moving`**: se deriva de ambos sensores — es `true` si la aceleración media supera `IS_MOVING_THRESHOLD_MPS2` (0.8 m/s²) **o** la rotación media supera `IS_MOVING_THRESHOLD_RADS` (0.35 rad/s). Queda en `null` solo si ninguno de los dos reportó, y en ese caso el backend difiere la regla de inmovilidad.
- **Sincronización** ([src/tracking/sync.ts](src/tracking/sync.ts)): cada 2 min o al recuperar conectividad (NetInfo) se envían lotes a `POST /telemetry/batch` (idempotente); backoff exponencial 10 s → 15 min en fallos.
- **Escaneo QR** ([src/screens/ScanScreen.tsx](src/screens/ScanScreen.tsx)): adjunta la última posición GPS conocida; si la fix tiene más de 30 s o accuracy peor a 50 m, pide esperar señal. La respuesta del backend (reglas 1 y 2) se muestra a pantalla completa en verde/rojo.
- **Persistencia**: la ronda activa sobrevive reinicios de la app (tabla `kv` en SQLite).

## Credenciales de prueba (seeds del backend)

`guardia1@protemaxi.ec` / `Guardia123!` — los QR de los 4 checkpoints se imprimen desde el dashboard (Administración → Checkpoints → QR).
