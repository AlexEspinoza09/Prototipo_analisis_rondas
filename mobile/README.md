# App móvil — Monitoreo de Rondas

App Android para guardias: inicia rondas, registra GPS en segundo plano, muestrea acelerómetro y giróscopo, guarda todo en SQLite local, sincroniza por lotes con reintentos y escanea los QR de los checkpoints con validación inmediata.

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

### APK release en local (sin EAS ni Metro)

Para probar en el teléfono sin cable ni servidor de Metro, con el JavaScript empaquetado dentro del APK:

En Windows, compila desde una unidad virtual con ruta corta (la carpeta del proyecto es larga y las rutas de CMake superan el límite de 260 caracteres). El mapeo se pierde al reiniciar:

```bat
subst R: "C:\Users\javier\Documents\PROYECTOS PERSONALES\proyecto_rondas"
cd /d R:\mobile\android
.\gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a
:: APK: mobile\android\app\build\outputs\apk\release\app-release.apk
```

Compila siempre desde la misma ruta (`R:\`): la caché de autolinking guarda rutas absolutas, y si cambias de ruta hay que borrar `android/build/generated/autolinking`. Además, [android/build.gradle](android/build.gradle) mueve los temporales de CMake a `%USERPROFILE%\.cxx` para acortar las rutas.

- La URL del backend sale de `mobile/.env` al compilar: si cambia la IP de tu PC, hay que recompilar.
- El teléfono debe estar en la misma red Wi-Fi que el PC con Docker, y el firewall de Windows debe permitir el puerto 8000.
- El manifiesto habilita `usesCleartextTraffic` porque el backend local usa `http://`. Si alguna vez regeneras `android/` con `expo prebuild`, vuelve a añadirlo.
- Va firmado con la clave de depuración: sirve para pruebas, no para distribución definitiva.

### Modo prueba sin servidor

Con `EXPO_PUBLIC_ALLOW_OFFLINE_MODE=true` en `.env` (solo para builds de prueba), el login muestra el interruptor **Modo prueba sin servidor**. Al activarlo:

- Se entra con el usuario demo (`guardia1@rondas.demo` / `Guardia123!`) sin contactar al backend.
- Aparece la ruta de los seeds con sus QR reales (los que se imprimen desde el dashboard). Los escaneos se validan en el teléfono solo por distancia (regla 1).
- GPS y sensores se guardan en SQLite como siempre, pero **nunca se envían**: las sesiones de prueba usan ids negativos y el sincronizador las ignora.
- **Datos del teléfono** (en la lista de rutas y en la ronda activa) muestra la última lectura de acelerómetro y giróscopo, la última posición GPS, los conteos guardados y los últimos puntos. También permite compartir todo como CSV o borrar los datos de prueba.

El código está en [src/offline/](src/offline/). Para un build real, deja la variable en `false`: el interruptor desaparece.

## Cómo funciona (resumen técnico)

- **Tracking**: al iniciar ronda se llama `POST /sessions/start` y se arranca `expo-location` con `expo-task-manager` ([src/tracking/locationTask.ts](src/tracking/locationTask.ts)): GPS cada 15 s con *foreground service* (notificación persistente). Cada punto se guarda primero en SQLite (`telemetry_buffer`, único por sesión+timestamp).
- **Sensores** ([src/tracking/sensors.ts](src/tracking/sensors.ts)): ventanas de 5 s cada 30 s de acelerómetro y giróscopo; solo se guarda el resumen de la ventana, no las muestras crudas: magnitud media de la aceleración (desviación de la gravedad, m/s²), su desviación estándar (cuánto vibra el teléfono) y la velocidad de rotación media (rad/s, `null` si el equipo no tiene giróscopo). Con eso el backend detecta inactividad (regla 2) y un teléfono inmóvil mientras el GPS se desplaza (regla 6). Limitación del prototipo: solo muestrea con la app en primer plano; con pantalla apagada los puntos llevan los campos de sensores en `null` y el backend no evalúa esas reglas para esos puntos.
- **Sincronización** ([src/tracking/sync.ts](src/tracking/sync.ts)): cada 2 min o al recuperar conectividad (NetInfo) se envían lotes a `POST /telemetry/batch` (idempotente); backoff exponencial 10 s → 15 min en fallos.
- **Escaneo QR** ([src/screens/ScanScreen.tsx](src/screens/ScanScreen.tsx)): adjunta la última posición GPS conocida; si la fix tiene más de 30 s o accuracy peor a 50 m, pide esperar señal. La respuesta del backend (reglas 1 y 2) se muestra a pantalla completa en verde/rojo.
- **Persistencia**: la ronda activa sobrevive reinicios de la app (tabla `kv` en SQLite).

## Cambio de identificador de la app

El paquete Android es `com.monitoreorondas.app`. Si en el teléfono hay una versión anterior instalada con otro identificador, Android la trata como otra app: desinstálala y regenera el build (`eas build ...` o, en local, `cd android && ./gradlew clean` antes de `npx expo run:android`).

## Credenciales de prueba (seeds del backend)

`guardia1@rondas.demo` / `Guardia123!` — los QR de los 4 checkpoints se imprimen desde el dashboard (Administración → Checkpoints → QR).
