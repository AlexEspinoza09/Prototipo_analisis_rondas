import {
  Camera,
  CircleLayer,
  LineLayer,
  MapView,
  ShapeSource,
} from '@maplibre/maplibre-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { RootStackParamList } from '../App';
import { Badge, Button, type Tone } from '../components/ui';
import { SCAN_MAX_ACCURACY_M } from '../config';
import { bufferedCount, sessionPointCount } from '../db/local';
import { haversineMeters } from '../lib/geo';
import { isOfflineMode } from '../offline/offlineMode';
import { usePatrol } from '../patrol/PatrolContext';
import { readLastFix, type LastFix } from '../tracking/locationTask';
import { colors, radius } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'ActivePatrol'>;

const OSM_STYLE = JSON.stringify({
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
});

function gpsStatus(fix: LastFix | null): { label: string; tone: Tone } {
  if (!fix) return { label: 'Esperando señal GPS', tone: 'warning' };
  const accuracy = Math.round(fix.accuracy_m);
  return fix.accuracy_m <= SCAN_MAX_ACCURACY_M
    ? { label: `GPS ±${accuracy} m`, tone: 'good' }
    : { label: `GPS débil ±${accuracy} m`, tone: 'warning' };
}

export function ActivePatrolScreen({ navigation }: Props) {
  const { patrol, endPatrol } = usePatrol();
  const insets = useSafeAreaInsets();
  const [fix, setFix] = useState<LastFix | null>(readLastFix());
  const offline = isOfflineMode();
  // Offline test sessions never sync: show what is stored instead of pending.
  const countPoints = () =>
    offline && patrol ? sessionPointCount(patrol.sessionId) : bufferedCount();
  const [pending, setPending] = useState(countPoints());
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setFix(readLastFix());
      setPending(countPoints());
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const nextCheckpoint =
    patrol?.route.checkpoints.find(
      (cp) => !patrol.scannedCheckpointIds.includes(cp.checkpoint_id),
    ) ?? null;

  // Every checkpoint of the route, colored by progress: done / next / pending.
  const checkpointShape = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: (patrol?.route.checkpoints ?? []).map((cp) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [cp.lng, cp.lat] },
        properties: {
          state: patrol?.scannedCheckpointIds.includes(cp.checkpoint_id)
            ? 'done'
            : cp.checkpoint_id === nextCheckpoint?.checkpoint_id
              ? 'next'
              : 'pending',
        },
      })),
    }),
    [patrol, nextCheckpoint],
  );

  if (!patrol) return null;

  const total = patrol.route.checkpoints.length;
  const done = patrol.scannedCheckpointIds.length;
  const distanceToNext =
    fix && nextCheckpoint
      ? Math.round(haversineMeters(fix.lat, fix.lng, nextCheckpoint.lat, nextCheckpoint.lng))
      : null;

  const center: [number, number] = fix
    ? [fix.lng, fix.lat]
    : nextCheckpoint
      ? [nextCheckpoint.lng, nextCheckpoint.lat]
      : [-78.4833, -0.184];

  const gps = gpsStatus(fix);

  const onEnd = () => {
    const missing = total - done;
    Alert.alert(
      'Finalizar ronda',
      missing > 0
        ? `Faltan ${missing} checkpoints por escanear. ¿Desea finalizar la ronda de todas formas?`
        : '¿Desea finalizar la ronda?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Finalizar',
          style: 'destructive',
          onPress: async () => {
            setEnding(true);
            try {
              await endPatrol();
            } catch {
              Alert.alert(
                'No fue posible finalizar la ronda',
                'Verifique su conexión e intente nuevamente.',
              );
            } finally {
              setEnding(false);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.mapWrap}>
        <MapView style={{ flex: 1 }} mapStyle={OSM_STYLE}>
          <Camera centerCoordinate={center} zoomLevel={16} />
          {patrol.route.path && patrol.route.path.length >= 2 && (
            <ShapeSource
              id="route-path"
              shape={{
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: patrol.route.path },
                properties: {},
              }}
            >
              <LineLayer
                id="route-path-line"
                style={{ lineColor: colors.muted, lineWidth: 2, lineDasharray: [2, 2] }}
              />
            </ShapeSource>
          )}
          <ShapeSource id="checkpoints" shape={checkpointShape}>
            <CircleLayer
              id="checkpoints-circle"
              style={{
                circleRadius: ['match', ['get', 'state'], 'next', 11, 8],
                circleColor: [
                  'match',
                  ['get', 'state'],
                  'done',
                  colors.good,
                  'next',
                  colors.primary,
                  colors.muted,
                ],
                circleStrokeWidth: 2,
                circleStrokeColor: '#ffffff',
              }}
            />
          </ShapeSource>
          {fix && (
            <ShapeSource
              id="me"
              shape={{
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [fix.lng, fix.lat] },
                properties: {},
              }}
            >
              <CircleLayer
                id="me-circle"
                style={{
                  circleRadius: 7,
                  circleColor: colors.position,
                  circleStrokeWidth: 3,
                  circleStrokeColor: '#ffffff',
                }}
              />
            </ShapeSource>
          )}
        </MapView>
        <View style={styles.mapBadges}>
          <Badge label={gps.label} tone={gps.tone} />
          {offline && <Badge label="Modo de prueba" tone="warning" />}
        </View>
      </View>

      <View style={[styles.panel, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.progressHeader}>
          <Text style={styles.routeName} numberOfLines={1}>
            {patrol.route.name}
          </Text>
          <Text style={styles.progressCount}>
            {done} de {total}
          </Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${total ? (done / total) * 100 : 0}%` }]} />
        </View>

        {nextCheckpoint ? (
          <View style={styles.nextRow}>
            <View style={styles.nextNumber}>
              <Text style={styles.nextNumberText}>{nextCheckpoint.sequence_order}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.nextLabel}>Siguiente checkpoint</Text>
              <Text style={styles.nextName} numberOfLines={1}>
                {nextCheckpoint.name}
              </Text>
            </View>
            {distanceToNext !== null && (
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.nextLabel}>Distancia</Text>
                <Text style={styles.nextName}>{distanceToNext} m</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={[styles.nextRow, { backgroundColor: colors.goodSoft }]}>
            <Text style={[styles.nextName, { color: colors.goodInk }]}>
              Todos los checkpoints fueron escaneados. Puede finalizar la ronda.
            </Text>
          </View>
        )}

        <Text style={styles.meta}>
          {pending} {offline ? 'puntos guardados en el teléfono' : 'puntos pendientes de envío'}
        </Text>

        <Button
          label="Escanear código QR"
          size="lg"
          onPress={() => navigation.navigate('Scan')}
        />
        <View style={styles.secondaryRow}>
          <Button
            label="Datos del teléfono"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() => navigation.navigate('Diagnostics')}
          />
          <Button
            label="Finalizar ronda"
            variant="danger"
            style={{ flex: 1 }}
            busy={ending}
            onPress={onEnd}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.plane },
  mapWrap: { flex: 1 },
  mapBadges: { position: 'absolute', top: 12, left: 12, gap: 6 },
  panel: {
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  progressHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  routeName: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.ink },
  progressCount: { fontSize: 13, fontWeight: '600', color: colors.ink2 },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primarySoft,
    marginTop: 8,
    overflow: 'hidden',
  },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
  nextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: colors.plane,
  },
  nextNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextNumberText: { color: '#fff', fontWeight: '700' },
  nextLabel: { fontSize: 12, color: colors.muted },
  nextName: { fontSize: 15, fontWeight: '600', color: colors.ink },
  meta: { fontSize: 12, color: colors.muted, marginTop: 10, marginBottom: 12 },
  secondaryRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
});
