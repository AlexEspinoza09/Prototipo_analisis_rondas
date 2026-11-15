import { CameraView, useCameraPermissions } from 'expo-camera';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api, ApiError } from '../api/client';
import type { ScanResult } from '../api/types';
import type { RootStackParamList } from '../App';
import { Button } from '../components/ui';
import { SCAN_MAX_ACCURACY_M, SCAN_MAX_FIX_AGE_MS } from '../config';
import { usePatrol } from '../patrol/PatrolContext';
import { colors, radius } from '../theme';
import { readLastFix } from '../tracking/locationTask';

type Props = NativeStackScreenProps<RootStackParamList, 'Scan'>;

export function ScanScreen({ navigation }: Props) {
  const { patrol, registerScan } = usePatrol();
  const [permission, requestPermission] = useCameraPermissions();
  const [message, setMessage] = useState<string | null>(null);
  const busyRef = useRef(false);

  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.infoTitle}>Permiso de cámara</Text>
        <Text style={styles.info}>
          La aplicación necesita acceso a la cámara para escanear los códigos QR de los checkpoints.
        </Text>
        <Button label="Permitir el uso de la cámara" onPress={() => void requestPermission()} />
      </View>
    );
  }

  const onBarcode = async ({ data }: { data: string }) => {
    if (busyRef.current || !patrol) return;
    busyRef.current = true;

    // GPS quality gate: the scan must carry a fresh, accurate position.
    const fix = readLastFix();
    const age = fix ? Date.now() - fix.ts : Infinity;
    if (!fix || age > SCAN_MAX_FIX_AGE_MS || fix.accuracy_m > SCAN_MAX_ACCURACY_M) {
      setMessage('Señal GPS insuficiente. Espere unos segundos al aire libre e intente nuevamente.');
      setTimeout(() => {
        setMessage(null);
        busyRef.current = false;
      }, 2500);
      return;
    }

    try {
      const result = await api<ScanResult>('/scans', {
        method: 'POST',
        body: JSON.stringify({
          session_id: patrol.sessionId,
          qr_code: data.trim(),
          lat: fix.lat,
          lng: fix.lng,
        }),
      });
      if (result.is_valid) registerScan(result.checkpoint_id);
      navigation.replace('ScanResult', { result });
    } catch (err) {
      setMessage(
        err instanceof ApiError && err.status === 404
          ? 'Código QR no reconocido.'
          : 'No fue posible registrar el escaneo. Verifique su conexión.',
      );
      setTimeout(() => {
        setMessage(null);
        busyRef.current = false;
      }, 2500);
    }
  };

  return (
    <View style={styles.container}>
      <CameraView
        style={{ flex: 1 }}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => void onBarcode({ data })}
      />
      <View style={styles.frameWrap} pointerEvents="none">
        <View style={styles.frame}>
          <View style={[styles.corner, styles.topLeft]} />
          <View style={[styles.corner, styles.topRight]} />
          <View style={[styles.corner, styles.bottomLeft]} />
          <View style={[styles.corner, styles.bottomRight]} />
        </View>
      </View>
      <View style={[styles.overlay, message !== null && styles.overlayWarning]}>
        <Text style={styles.overlayText}>
          {message ?? 'Ubique el código QR del checkpoint dentro del recuadro'}
        </Text>
      </View>
    </View>
  );
}

const FRAME = 240;
const CORNER = 28;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.plane,
  },
  infoTitle: { fontSize: 17, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  info: { textAlign: 'center', color: colors.ink2, marginTop: 6, marginBottom: 20 },
  frameWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  frame: { width: FRAME, height: FRAME },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: '#fff' },
  topLeft: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 12 },
  topRight: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 12 },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 12,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 12,
  },
  overlay: {
    position: 'absolute',
    bottom: 32,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(15,28,46,0.88)',
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  overlayWarning: { backgroundColor: 'rgba(180,35,24,0.94)' },
  overlayText: { color: '#fff', textAlign: 'center', fontSize: 15, fontWeight: '600' },
});
