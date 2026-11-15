import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { RootStackParamList } from '../App';
import { REASON_LABELS } from '../lib/labels';
import { radius } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'ScanResult'>;

// Full-screen, high-contrast feedback: it must be readable at a glance outdoors.
const VALID_BG = '#0b7a0b';
const INVALID_BG = '#b42318';

export function ScanResultScreen({ navigation, route }: Props) {
  const { result } = route.params;
  const insets = useSafeAreaInsets();
  const color = result.is_valid ? VALID_BG : INVALID_BG;

  return (
    <View style={[styles.container, { backgroundColor: color, paddingBottom: insets.bottom + 24 }]}>
      <StatusBar style="light" />
      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <Text style={[styles.icon, { color }]}>{result.is_valid ? '✓' : '✕'}</Text>
        </View>
        <Text style={styles.title}>
          {result.is_valid ? 'Escaneo válido' : 'Escaneo no válido'}
        </Text>
        <Text style={styles.checkpoint}>{result.checkpoint_name}</Text>

        <View style={styles.details}>
          {result.invalid_reason && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Motivo</Text>
              <Text style={styles.detailValue}>{REASON_LABELS[result.invalid_reason]}</Text>
            </View>
          )}
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Distancia al checkpoint</Text>
            <Text style={styles.detailValue}>
              {Math.round(result.distance_to_checkpoint_m)} m
            </Text>
          </View>
          <View style={[styles.detailRow, { borderBottomWidth: 0 }]}>
            <Text style={styles.detailLabel}>Radio permitido</Text>
            <Text style={styles.detailValue}>{result.radius_m} m</Text>
          </View>
        </View>
      </View>

      <TouchableOpacity
        style={styles.button}
        activeOpacity={0.85}
        onPress={() => navigation.goBack()}
      >
        <Text style={[styles.buttonText, { color }]}>Continuar la ronda</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  iconCircle: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  icon: { fontSize: 64, fontWeight: '700', lineHeight: 72 },
  title: { fontSize: 28, color: '#fff', fontWeight: '700' },
  checkpoint: { fontSize: 18, color: '#fff', marginTop: 6, textAlign: 'center' },
  details: {
    alignSelf: 'stretch',
    marginTop: 28,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.2)',
  },
  detailLabel: { fontSize: 14, color: 'rgba(255,255,255,0.85)' },
  detailValue: { flexShrink: 1, fontSize: 14, color: '#fff', fontWeight: '700', textAlign: 'right' },
  button: {
    backgroundColor: '#fff',
    borderRadius: radius.md,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 17, fontWeight: '700' },
});
