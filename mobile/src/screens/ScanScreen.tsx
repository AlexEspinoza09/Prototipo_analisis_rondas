import { CameraView, useCameraPermissions } from 'expo-camera';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { api, ApiError } from '../api/client';
import type { ScanResult } from '../api/types';
import type { RootStackParamList } from '../App';
import { SCAN_MAX_ACCURACY_M, SCAN_MAX_FIX_AGE_MS } from '../config';
import { usePatrol } from '../patrol/PatrolContext';
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
        <Text style={styles.info}>Se necesita acceso a la cámara para escanear el QR.</Text>
        <TouchableOpacity style={styles.button} onPress={() => void requestPermission()}>
          <Text style={styles.buttonText}>Permitir cámara</Text>
        </TouchableOpacity>
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
      setMessage('Señal GPS insuficiente. Espera unos segundos al aire libre y reintenta.');
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
          : 'No se pudo registrar el escaneo. Revisa tu conexión.',
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
      <View style={styles.overlay}>
        <Text style={styles.overlayText}>
          {message ?? 'Apunta la cámara al código QR del checkpoint'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  info: { textAlign: 'center', color: '#52514e', marginBottom: 16 },
  button: { backgroundColor: '#2a78d6', borderRadius: 8, padding: 12 },
  buttonText: { color: '#fff', fontWeight: '600' },
  overlay: {
    position: 'absolute',
    bottom: 32,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 8,
    padding: 12,
  },
  overlayText: { color: '#fff', textAlign: 'center' },
});
