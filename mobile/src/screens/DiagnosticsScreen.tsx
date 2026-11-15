import { Gyroscope } from 'expo-sensors';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { API_URL } from '../config';
import {
  deleteOfflineData,
  offlineScans,
  recentTelemetry,
  telemetryStats,
  type BufferedPoint,
  type OfflineScan,
  type TelemetryStats,
} from '../db/local';
import { REASON_LABELS } from '../lib/labels';
import { isOfflineMode } from '../offline/offlineMode';
import { usePatrol } from '../patrol/PatrolContext';
import { readLastFix, type LastFix } from '../tracking/locationTask';
import {
  readLastSensorWindow,
  startSensorSampling,
  stopSensorSampling,
  type SensorWindow,
} from '../tracking/sensors';

const REFRESH_MS = 3000;
const RECENT_POINTS = 15;
const EXPORT_LIMIT = 5000;

const fmt = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined ? '—' : value.toFixed(digits);

const ageSeconds = (ts: number) => Math.round((Date.now() - ts) / 1000);

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function toCsv(points: BufferedPoint[]): string {
  const header =
    'session_id,recorded_at,lat,lng,accuracy_m,speed_mps,accel_magnitude,accel_std,gyro_magnitude,is_moving';
  const rows = points.map((p) =>
    [
      p.session_id,
      p.recorded_at,
      p.lat,
      p.lng,
      p.accuracy_m,
      p.speed_mps ?? '',
      p.accel_magnitude ?? '',
      p.accel_std ?? '',
      p.gyro_magnitude ?? '',
      p.is_moving ?? '',
    ].join(','),
  );
  return [header, ...rows].join('\n');
}

/** Shows what the phone is capturing and storing, with no server needed. */
export function DiagnosticsScreen() {
  const { patrol } = usePatrol();
  const [stats, setStats] = useState<TelemetryStats>(telemetryStats());
  const [points, setPoints] = useState<BufferedPoint[]>([]);
  const [scans, setScans] = useState<OfflineScan[]>([]);
  const [sensors, setSensors] = useState<SensorWindow | null>(null);
  const [fix, setFix] = useState<LastFix | null>(null);
  const [gyroAvailable, setGyroAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    // Sample sensors while this screen is open, even with no patrol running.
    const ownSampling = patrol === null;
    if (ownSampling) startSensorSampling();
    void Gyroscope.isAvailableAsync()
      .then(setGyroAvailable)
      .catch(() => setGyroAvailable(false));

    const refresh = () => {
      setStats(telemetryStats());
      setPoints(recentTelemetry(RECENT_POINTS));
      setScans(offlineScans().slice(0, 10));
      setSensors(readLastSensorWindow());
      setFix(readLastFix());
    };
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => {
      clearInterval(timer);
      if (ownSampling) stopSensorSampling();
    };
  }, [patrol]);

  const onShare = async () => {
    const all = recentTelemetry(EXPORT_LIMIT).reverse();
    if (all.length === 0) {
      Alert.alert('Sin datos', 'Todavía no hay puntos guardados.');
      return;
    }
    await Share.share({ title: 'Telemetría de rondas', message: toCsv(all) });
  };

  const onClear = () => {
    Alert.alert(
      'Borrar datos de prueba',
      'Se borran los puntos y escaneos de las rondas sin servidor. Los datos pendientes de enviar al servidor no se tocan.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Borrar',
          style: 'destructive',
          onPress: () => {
            deleteOfflineData();
            setStats(telemetryStats());
            setPoints(recentTelemetry(RECENT_POINTS));
            setScans([]);
          },
        },
      ],
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <View style={styles.card}>
        <Text style={styles.title}>Modo</Text>
        <Text style={styles.line}>
          {isOfflineMode() ? 'Prueba sin servidor: nada se envía' : `Servidor: ${API_URL}`}
        </Text>
        <Text style={styles.line}>
          Ronda activa: {patrol ? `#${patrol.sessionId}` : 'ninguna'}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>Sensores (ventana de 5 s cada 30 s)</Text>
        <Text style={styles.line}>
          Giroscopio: {gyroAvailable === null ? 'comprobando…' : gyroAvailable ? 'disponible' : 'no disponible'}
        </Text>
        {sensors ? (
          <>
            <Text style={styles.line}>Aceleración media: {fmt(sensors.value)} m/s²</Text>
            <Text style={styles.line}>Variabilidad (vibración): {fmt(sensors.std, 3)} m/s²</Text>
            <Text style={styles.line}>Rotación media: {fmt(sensors.gyro, 3)} rad/s</Text>
            <Text style={styles.muted}>Última lectura hace {ageSeconds(sensors.ts)} s</Text>
          </>
        ) : (
          <Text style={styles.muted}>Esperando la primera ventana (hasta 5 s)…</Text>
        )}
        <Text style={styles.muted}>Los sensores solo se leen con la app abierta.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>GPS</Text>
        {fix ? (
          <>
            <Text style={styles.line}>
              {fix.lat.toFixed(6)}, {fix.lng.toFixed(6)} · ±{Math.round(fix.accuracy_m)} m
            </Text>
            <Text style={styles.muted}>Última posición hace {ageSeconds(fix.ts)} s</Text>
          </>
        ) : (
          <Text style={styles.muted}>Sin posición todavía: inicia una ronda.</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>Guardado en el teléfono</Text>
        <Text style={styles.line}>Puntos totales: {stats.total}</Text>
        <Text style={styles.line}>De rondas sin servidor: {stats.offline}</Text>
        <Text style={styles.line}>Pendientes de enviar al servidor: {stats.pending}</Text>
        <Text style={styles.line}>
          Con datos de sensores: {stats.withSensors} · con giroscopio: {stats.withGyro}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>Últimos {RECENT_POINTS} puntos</Text>
        <Text style={styles.mono}>hora      ±m   acel   vibr   giro  mov</Text>
        {points.map((p) => (
          <Text key={p.id} style={styles.mono}>
            {clock(p.recorded_at)} {fmt(p.accuracy_m, 0).padStart(4)} {fmt(p.accel_magnitude).padStart(6)}{' '}
            {fmt(p.accel_std).padStart(6)} {fmt(p.gyro_magnitude).padStart(6)}{' '}
            {p.is_moving === null ? ' —' : p.is_moving ? ' sí' : ' no'}
          </Text>
        ))}
        {points.length === 0 && <Text style={styles.muted}>Sin puntos todavía.</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>Escaneos sin servidor</Text>
        {scans.map((s) => (
          <Text key={s.id} style={styles.line}>
            {clock(s.scanned_at)} · {s.checkpoint_name} · {Math.round(s.distance_m)} m ·{' '}
            {s.is_valid
              ? 'válido'
              : REASON_LABELS[s.invalid_reason as keyof typeof REASON_LABELS] ?? 'inválido'}
          </Text>
        ))}
        {scans.length === 0 && <Text style={styles.muted}>Sin escaneos de prueba.</Text>}
      </View>

      <TouchableOpacity style={styles.button} onPress={() => void onShare()}>
        <Text style={styles.buttonText}>Compartir datos (CSV)</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.dangerButton} onPress={onClear}>
        <Text style={styles.dangerText}>Borrar datos de prueba</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9f9f7' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, elevation: 1 },
  title: { fontSize: 15, fontWeight: '700', color: '#0b0b0b', marginBottom: 6 },
  line: { fontSize: 14, color: '#0b0b0b', marginBottom: 2 },
  muted: { fontSize: 12, color: '#898781', marginTop: 2 },
  mono: { fontFamily: 'monospace', fontSize: 11, color: '#0b0b0b' },
  button: { backgroundColor: '#2a78d6', borderRadius: 8, padding: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
  dangerButton: {
    borderWidth: 1,
    borderColor: '#d03b3b',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    marginBottom: 24,
  },
  dangerText: { color: '#d03b3b', fontWeight: '600' },
});
