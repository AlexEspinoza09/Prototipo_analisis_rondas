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
- **Acelerómetro** ([src/tracking/accelerometer.ts](src/tracking/accelerometer.ts)): ventanas de 5 s cada 30 s; solo se guarda la magnitud media (desviación de la gravedad, m/s²). Limitación del prototipo: solo muestrea con la app en primer plano; con pantalla apagada los puntos llevan `accel_magnitude = null` y el backend difiere la regla de inmovilidad.
- **Sincronización** ([src/tracking/sync.ts](src/tracking/sync.ts)): cada 2 min o al recuperar conectividad (NetInfo) se envían lotes a `POST /telemetry/batch` (idempotente); backoff exponencial 10 s → 15 min en fallos.
- **Escaneo QR** ([src/screens/ScanScreen.tsx](src/screens/ScanScreen.tsx)): adjunta la última posición GPS conocida; si la fix tiene más de 30 s o accuracy peor a 50 m, pide esperar señal. La respuesta del backend (reglas 1 y 2) se muestra a pantalla completa en verde/rojo.
- **Persistencia**: la ronda activa sobrevive reinicios de la app (tabla `kv` en SQLite).

## Credenciales de prueba (seeds del backend)

`guardia1@protemaxi.ec` / `Guardia123!` — los QR de los 4 checkpoints se imprimen desde el dashboard (Administración → Checkpoints → QR).
