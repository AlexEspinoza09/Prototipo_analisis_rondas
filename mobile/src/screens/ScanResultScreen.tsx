import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { RootStackParamList } from '../App';
import { REASON_LABELS } from '../lib/labels';

type Props = NativeStackScreenProps<RootStackParamList, 'ScanResult'>;

export function ScanResultScreen({ navigation, route }: Props) {
  const { result } = route.params;
  const color = result.is_valid ? '#0ca30c' : '#d03b3b';

  return (
    <View style={[styles.container, { backgroundColor: color }]}>
      <Text style={styles.icon}>{result.is_valid ? '✓' : '✗'}</Text>
      <Text style={styles.title}>
        {result.is_valid ? 'Escaneo válido' : 'Escaneo inválido'}
      </Text>
      <Text style={styles.checkpoint}>{result.checkpoint_name}</Text>
      <Text style={styles.detail}>
        Distancia al checkpoint: {Math.round(result.distance_to_checkpoint_m)} m (radio{' '}
        {result.radius_m} m)
      </Text>
      {result.invalid_reason && (
        <Text style={styles.reason}>{REASON_LABELS[result.invalid_reason]}</Text>
      )}
      <TouchableOpacity style={styles.button} onPress={() => navigation.goBack()}>
        <Text style={[styles.buttonText, { color }]}>Continuar la ronda</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  icon: { fontSize: 96, color: '#fff', fontWeight: '700' },
  title: { fontSize: 28, color: '#fff', fontWeight: '700', marginBottom: 8 },
  checkpoint: { fontSize: 18, color: '#fff', marginBottom: 4 },
  detail: { fontSize: 14, color: 'rgba(255,255,255,0.9)', marginBottom: 4 },
  reason: { fontSize: 16, color: '#fff', fontWeight: '600', marginTop: 8 },
  button: {
    marginTop: 32,
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  buttonText: { fontSize: 16, fontWeight: '700' },
});
