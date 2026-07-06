import { Camera, CircleLayer, MapView, ShapeSource } from '@maplibre/maplibre-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { RootStackParamList } from '../App';
import { bufferedCount } from '../db/local';
import { haversineMeters } from '../lib/geo';
import { usePatrol } from '../patrol/PatrolContext';
import { readLastFix, type LastFix } from '../tracking/locationTask';

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

export function ActivePatrolScreen({ navigation }: Props) {
  const { patrol, endPatrol } = usePatrol();
  const [fix, setFix] = useState<LastFix | null>(readLastFix());
  const [pending, setPending] = useState(bufferedCount());
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setFix(readLastFix());
      setPending(bufferedCount());
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  if (!patrol) return null;

  const nextCheckpoint =
    patrol.route.checkpoints.find(
      (cp) => !patrol.scannedCheckpointIds.includes(cp.checkpoint_id),
    ) ?? null;

  const distanceToNext =
    fix && nextCheckpoint
      ? Math.round(haversineMeters(fix.lat, fix.lng, nextCheckpoint.lat, nextCheckpoint.lng))
      : null;

  const center: [number, number] = fix
    ? [fix.lng, fix.lat]
    : nextCheckpoint
      ? [nextCheckpoint.lng, nextCheckpoint.lat]
      : [-78.488, -0.176];

  const onEnd = () => {
    Alert.alert('Finalizar ronda', '¿Seguro que quieres finalizar la ronda?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Finalizar',
        style: 'destructive',
        onPress: async () => {
          setEnding(true);
          try {
            await endPatrol();
          } catch {
            Alert.alert('Error', 'No se pudo cerrar la sesión. Revisa tu conexión.');
          } finally {
            setEnding(false);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.mapWrap}>
        <MapView style={{ flex: 1 }} mapStyle={OSM_STYLE}>
          <Camera centerCoordinate={center} zoomLevel={16} />
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
                  circleRadius: 8,
                  circleColor: '#2a78d6',
                  circleStrokeWidth: 2,
                  circleStrokeColor: '#ffffff',
                }}
              />
            </ShapeSource>
          )}
          {nextCheckpoint && (
            <ShapeSource
              id="next-cp"
              shape={{
                type: 'Feature',
                geometry: {
                  type: 'Point',
                  coordinates: [nextCheckpoint.lng, nextCheckpoint.lat],
                },
                properties: {},
              }}
            >
              <CircleLayer
                id="next-cp-circle"
                style={{
                  circleRadius: 10,
                  circleColor: '#0ca30c',
                  circleStrokeWidth: 2,
                  circleStrokeColor: '#ffffff',
                }}
              />
            </ShapeSource>
          )}
        </MapView>
      </View>

      <View style={styles.panel}>
        <Text style={styles.routeName}>{patrol.route.name}</Text>
        {nextCheckpoint ? (
          <Text style={styles.next}>
            Siguiente: {nextCheckpoint.sequence_order}. {nextCheckpoint.name}
            {distanceToNext !== null ? ` · a ${distanceToNext} m` : ''}
          </Text>
        ) : (
          <Text style={[styles.next, { color: '#0ca30c' }]}>
            ✓ Todos los checkpoints escaneados
          </Text>
        )}
        <Text style={styles.meta}>
          {patrol.scannedCheckpointIds.length}/{patrol.route.checkpoints.length} checkpoints ·{' '}
          {pending} puntos por sincronizar
          {fix ? ` · GPS ±${Math.round(fix.accuracy_m)} m` : ' · Esperando GPS…'}
        </Text>

        <TouchableOpacity style={styles.scanButton} onPress={() => navigation.navigate('Scan')}>
          <Text style={styles.scanButtonText}>Escanear QR</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.endButton, ending && { opacity: 0.6 }]}
          disabled={ending}
          onPress={onEnd}
        >
          <Text style={styles.endButtonText}>
            {ending ? 'Finalizando…' : 'Finalizar ronda'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9f9f7' },
  mapWrap: { flex: 1 },
  panel: {
    backgroundColor: '#fff',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#e1e0d9',
  },
  routeName: { fontSize: 17, fontWeight: '700', color: '#0b0b0b' },
  next: { fontSize: 15, color: '#0b0b0b', marginTop: 4 },
  meta: { fontSize: 12, color: '#898781', marginTop: 4, marginBottom: 12 },
  scanButton: {
    backgroundColor: '#2a78d6',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginBottom: 8,
  },
  scanButtonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  endButton: {
    borderWidth: 1,
    borderColor: '#d03b3b',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  endButtonText: { color: '#d03b3b', fontWeight: '600' },
});
