import { Gyroscope } from 'expo-sensors';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { Badge, Button, Card, DataRow, SectionTitle } from '../components/ui';

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
import { colors } from '../theme';
import { readLastFix, type LastFix } from '../tracking/locationTask';
import {
  readLastSensorWindow,
  sampleSensorWindow,
  storeSensorWindow,
  type StoredSensorWindow,
} from '../tracking/sensors';

const REFRESH_MS = 3000;
// With no patrol running, this screen takes its own sensor windows this often.
const OWN_SAMPLING_MS = 10_000;
const RECENT_POINTS = 15;
const EXPORT_LIMIT = 5000;

const fmt = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined ? '—' : value.toFixed(digits);

const ageSeconds = (ts: number) => Math.round((Date.now() - ts) / 1000);

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// Every stored column, in a stable order, so the export keeps up with new features.
const CSV_COLUMNS = [
  'session_id',
  'recorded_at',
  'lat',
  'lng',
  'accuracy_m',
  'speed_mps',
  'accel_magnitude',
  'accel_std',
  'accel_max',
  'accel_dominant_hz',
  'accel_peak_ratio',
  'gyro_magnitude',
  'gyro_std',
  'gyro_max',
  'gyro_dominant_hz',
  'gyro_peak_ratio',
  'sensor_sample_count',
  'is_moving',
] as const satisfies ReadonlyArray<keyof BufferedPoint>;

function toCsv(points: BufferedPoint[]): string {
  const rows = points.map((p) => CSV_COLUMNS.map((column) => p[column] ?? '').join(','));
  return [CSV_COLUMNS.join(','), ...rows].join('\n');
}

/** Shows what the phone is capturing and storing, with no server needed. */
export function DiagnosticsScreen() {
  const { patrol } = usePatrol();
  const [stats, setStats] = useState<TelemetryStats>(telemetryStats());
  const [points, setPoints] = useState<BufferedPoint[]>([]);
  const [scans, setScans] = useState<OfflineScan[]>([]);
  const [sensors, setSensors] = useState<StoredSensorWindow | null>(null);
  const [fix, setFix] = useState<LastFix | null>(null);
  const [gyroAvailable, setGyroAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    // During a patrol the location task samples the sensors on every GPS fix;
    // with no patrol, sample here so the sensors can still be checked.
    let active = true;
    const sampleOnce = async () => {
      const window = storeSensorWindow(await sampleSensorWindow());
      if (active) setSensors(window);
    };
    const sampler =
      patrol === null ? setInterval(() => void sampleOnce(), OWN_SAMPLING_MS) : null;
    if (patrol === null) void sampleOnce();
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
      active = false;
      clearInterval(timer);
      if (sampler !== null) clearInterval(sampler);
    };
  }, [patrol]);

  const onShare = async () => {
    const all = recentTelemetry(EXPORT_LIMIT).reverse();
    if (all.length === 0) {
      Alert.alert('Sin datos', 'Todavía no hay puntos registrados.');
      return;
    }
    await Share.share({ title: 'Telemetría de rondas', message: toCsv(all) });
  };

  const onClear = () => {
    Alert.alert(
      'Borrar datos de prueba',
      'Se eliminarán los puntos y escaneos de las rondas de prueba. Los datos pendientes de envío al servidor se conservan.',
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
      <Card>
        <SectionTitle>Estado</SectionTitle>
        <DataRow
          label="Modo"
          value={isOfflineMode() ? 'Prueba sin servidor' : 'Conectado al servidor'}
        />
        {!isOfflineMode() && <DataRow label="Servidor" value={API_URL} />}
        <DataRow label="Ronda activa" value={patrol ? `N.º ${patrol.sessionId}` : 'Ninguna'} last />
      </Card>

      <Card>
        <SectionTitle>Sensores</SectionTitle>
        <DataRow
          label="Giroscopio"
          value={
            gyroAvailable === null ? 'Comprobando…' : gyroAvailable ? 'Disponible' : 'No disponible'
          }
        />
        {sensors ? (
          <>
            <DataRow label="Aceleración media" value={`${fmt(sensors.accel_magnitude)} m/s²`} />
            <DataRow label="Vibración" value={`${fmt(sensors.accel_std, 3)} m/s²`} />
            <DataRow label="Aceleración máxima" value={`${fmt(sensors.accel_max)} m/s²`} />
            <DataRow
              label="Cadencia dominante"
              value={
                sensors.accel_dominant_hz === null
                  ? '—'
                  : `${fmt(sensors.accel_dominant_hz, 1)} Hz (${fmt((sensors.accel_peak_ratio ?? 0) * 100, 0)} %)`
              }
            />
            <DataRow label="Rotación media" value={`${fmt(sensors.gyro_magnitude, 3)} rad/s`} />
            <DataRow label="Rotación máxima" value={`${fmt(sensors.gyro_max, 3)} rad/s`} />
            <DataRow label="Muestras en la ventana" value={String(sensors.sensor_sample_count ?? '—')} />
            <DataRow label="Última lectura" value={`hace ${ageSeconds(sensors.ts)} s`} last />
          </>
        ) : (
          <DataRow label="Última lectura" value="Esperando (hasta 5 s)…" last />
        )}
        <Text style={styles.hint}>
          Durante la ronda se mide una ventana de 5 s con cada posición GPS, también con la
          pantalla apagada.
        </Text>
      </Card>

      <Card>
        <SectionTitle>GPS</SectionTitle>
        {fix ? (
          <>
            <DataRow label="Posición" value={`${fix.lat.toFixed(6)}, ${fix.lng.toFixed(6)}`} />
            <DataRow label="Precisión" value={`±${Math.round(fix.accuracy_m)} m`} />
            <DataRow label="Última posición" value={`hace ${ageSeconds(fix.ts)} s`} last />
          </>
        ) : (
          <Text style={styles.hint}>Sin posición todavía: inicie una ronda.</Text>
        )}
      </Card>

      <Card>
        <SectionTitle>Datos guardados en el teléfono</SectionTitle>
        <DataRow label="Puntos totales" value={String(stats.total)} />
        <DataRow label="De rondas de prueba" value={String(stats.offline)} />
        <DataRow label="Pendientes de envío" value={String(stats.pending)} />
        <DataRow label="Con datos de sensores" value={String(stats.withSensors)} />
        <DataRow label="Con giroscopio" value={String(stats.withGyro)} last />
      </Card>

      <Card>
        <SectionTitle>{`Últimos ${RECENT_POINTS} puntos`}</SectionTitle>
        <Text style={[styles.mono, styles.monoHeader]}>hora      ±m   acel   vibr   giro  mov</Text>
        {points.map((p) => (
          <Text key={p.id} style={styles.mono}>
            {clock(p.recorded_at)} {fmt(p.accuracy_m, 0).padStart(4)} {fmt(p.accel_magnitude).padStart(6)}{' '}
            {fmt(p.accel_std).padStart(6)} {fmt(p.gyro_magnitude).padStart(6)}{' '}
            {p.is_moving === null ? ' —' : p.is_moving ? ' sí' : ' no'}
          </Text>
        ))}
        {points.length === 0 && <Text style={styles.hint}>Sin puntos registrados.</Text>}
      </Card>

      <Card>
        <SectionTitle>Escaneos de prueba</SectionTitle>
        {scans.map((s) => (
          <View key={s.id} style={styles.scanRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.scanName}>{s.checkpoint_name}</Text>
              <Text style={styles.hint}>
                {clock(s.scanned_at)} · a {Math.round(s.distance_m)} m
              </Text>
            </View>
            <Badge
              tone={s.is_valid ? 'good' : 'critical'}
              label={
                s.is_valid
                  ? 'Válido'
                  : (REASON_LABELS[s.invalid_reason as keyof typeof REASON_LABELS] ?? 'No válido')
              }
            />
          </View>
        ))}
        {scans.length === 0 && <Text style={styles.hint}>Sin escaneos de prueba.</Text>}
      </Card>

      <Button label="Compartir datos (CSV)" onPress={() => void onShare()} />
      <Button
        label="Borrar datos de prueba"
        variant="danger"
        onPress={onClear}
        style={{ marginBottom: 24 }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.plane },
  hint: { fontSize: 12, color: colors.muted, marginTop: 6 },
  mono: { fontFamily: 'monospace', fontSize: 11, color: colors.ink },
  monoHeader: { color: colors.muted, marginBottom: 2 },
  scanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  scanName: { fontSize: 14, fontWeight: '600', color: colors.ink },
});
