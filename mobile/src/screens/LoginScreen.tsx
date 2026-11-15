import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ALLOW_OFFLINE_MODE, OFFLINE_DEMO_EMAIL, OFFLINE_DEMO_PASSWORD } from '../config';

export function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);

  const toggleOffline = (value: boolean) => {
    setOffline(value);
    setError(null);
    if (value) {
      setEmail(OFFLINE_DEMO_EMAIL);
      setPassword(OFFLINE_DEMO_PASSWORD);
    }
  };

  const onSubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password, offline);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'Credenciales incorrectas'
          : 'No se pudo conectar con el servidor',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior="padding">
      <View style={styles.card}>
        <Text style={styles.title}>Monitoreo de Rondas</Text>
        <Text style={styles.subtitle}>Monitoreo inteligente de rondas de seguridad</Text>
        <TextInput
          style={styles.input}
          placeholder="Correo"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Contraseña"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        {ALLOW_OFFLINE_MODE && (
          <View style={styles.offlineRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.offlineLabel}>Modo prueba sin servidor</Text>
              <Text style={styles.offlineHint}>
                Los datos se guardan solo en el teléfono. Usuario {OFFLINE_DEMO_EMAIL}
              </Text>
            </View>
            <Switch value={offline} onValueChange={toggleOffline} />
          </View>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
        <TouchableOpacity
          style={[styles.button, busy && styles.buttonDisabled]}
          onPress={onSubmit}
          disabled={busy || !email || !password}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Ingresar</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#f9f9f7' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 24, elevation: 2 },
  title: { fontSize: 24, fontWeight: '700', color: '#0b0b0b' },
  subtitle: { fontSize: 14, color: '#898781', marginBottom: 24 },
  input: {
    borderWidth: 1,
    borderColor: '#e1e0d9',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  error: { color: '#d03b3b', marginBottom: 12 },
  offlineRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  offlineLabel: { fontSize: 14, fontWeight: '600', color: '#0b0b0b' },
  offlineHint: { fontSize: 12, color: '#898781', marginTop: 2 },
  button: {
    backgroundColor: '#2a78d6',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
