import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Button, Notice } from '../components/ui';
import { ALLOW_OFFLINE_MODE, OFFLINE_DEMO_EMAIL, OFFLINE_DEMO_PASSWORD } from '../config';
import { colors, radius } from '../theme';

export function LoginScreen() {
  const { login } = useAuth();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
          ? 'El correo o la contraseña no son correctos.'
          : 'No fue posible conectar con el servidor. Verifique su conexión e intente nuevamente.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior="padding">
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        bounces={false}
      >
        <View style={[styles.hero, { paddingTop: insets.top + 40 }]}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>MR</Text>
          </View>
          <Text style={styles.brand}>Monitoreo de Rondas</Text>
          <Text style={styles.tagline}>Monitoreo inteligente de rondas de seguridad</Text>
        </View>

        <View style={styles.body}>
          <View style={styles.card}>
            <Text style={styles.title}>Iniciar sesión</Text>
            <Text style={styles.subtitle}>Ingrese sus credenciales para comenzar su ronda.</Text>

            {error && (
              <View style={{ marginBottom: 14 }}>
                <Notice text={error} />
              </View>
            )}

            <Text style={styles.label}>Correo electrónico</Text>
            <TextInput
              style={styles.input}
              placeholder="usuario@organizacion.com"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />

            <Text style={styles.label}>Contraseña</Text>
            <View style={styles.passwordRow}>
              <TextInput
                style={[styles.input, styles.passwordInput]}
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={setPassword}
              />
              <TouchableOpacity
                style={styles.passwordToggle}
                onPress={() => setShowPassword((value) => !value)}
                accessibilityLabel={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                <Text style={styles.passwordToggleText}>{showPassword ? 'Ocultar' : 'Mostrar'}</Text>
              </TouchableOpacity>
            </View>

            {ALLOW_OFFLINE_MODE && (
              <View style={styles.offlineRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.offlineLabel}>Modo de prueba sin servidor</Text>
                  <Text style={styles.offlineHint}>
                    Los datos se guardan únicamente en el teléfono.
                  </Text>
                </View>
                <Switch
                  value={offline}
                  onValueChange={toggleOffline}
                  trackColor={{ true: colors.primary, false: colors.border }}
                  thumbColor="#ffffff"
                />
              </View>
            )}

            <Button
              label="Ingresar"
              size="lg"
              busy={busy}
              disabled={!email || !password}
              onPress={() => void onSubmit()}
            />
          </View>

          <Text style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
            Acceso exclusivo para personal autorizado.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.plane },
  hero: {
    backgroundColor: colors.navy,
    paddingHorizontal: 24,
    paddingBottom: 72,
    alignItems: 'center',
  },
  logo: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  logoText: { color: '#fff', fontSize: 20, fontWeight: '700', letterSpacing: 1 },
  brand: { color: '#fff', fontSize: 22, fontWeight: '700' },
  tagline: { color: '#9aa7b8', fontSize: 13, marginTop: 6, textAlign: 'center' },
  body: { flex: 1, paddingHorizontal: 20, marginTop: -44 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    elevation: 3,
  },
  title: { fontSize: 20, fontWeight: '700', color: colors.ink },
  subtitle: { fontSize: 13, color: colors.ink2, marginTop: 4, marginBottom: 18 },
  label: { fontSize: 13, fontWeight: '600', color: colors.ink2, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  passwordRow: { justifyContent: 'center' },
  passwordInput: { paddingRight: 84 },
  passwordToggle: { position: 'absolute', right: 6, top: 4, padding: 10 },
  passwordToggleText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  offlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: colors.plane,
  },
  offlineLabel: { fontSize: 14, fontWeight: '600', color: colors.ink },
  offlineHint: { fontSize: 12, color: colors.muted, marginTop: 2 },
  footer: { textAlign: 'center', color: colors.muted, fontSize: 12, marginTop: 20 },
});
