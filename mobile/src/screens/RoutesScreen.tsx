import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { Alert, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '../api/client';
import type { RouteItem } from '../api/types';
import type { RootStackParamList } from '../App';
import { useAuth } from '../auth/AuthContext';
import { Badge, Button, Card, EmptyState, Notice } from '../components/ui';
import { PATROL_MODE_LABELS } from '../lib/labels';
import { isOfflineMode } from '../offline/offlineMode';
import { usePatrol } from '../patrol/PatrolContext';
import { colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Routes'>;

function Fact({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factValue}>{value}</Text>
      <Text style={styles.factLabel}>{label}</Text>
    </View>
  );
}

export function RoutesScreen({ navigation }: Props) {
  const { user, logout } = useAuth();
  const { startPatrol } = usePatrol();
  const insets = useSafeAreaInsets();
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [startingId, setStartingId] = useState<number | null>(null);

  const load = async () => {
    setRefreshing(true);
    try {
      const all = await api<RouteItem[]>('/routes');
      setRoutes(all.filter((route) => route.is_active));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const onStart = (route: RouteItem) => {
    Alert.alert('Iniciar ronda', `¿Desea iniciar la ronda "${route.name}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Iniciar',
        onPress: async () => {
          setStartingId(route.id);
          try {
            await startPatrol(route, `${user?.id ?? 'guard'}-device`);
          } catch (err) {
            Alert.alert(
              'No fue posible iniciar la ronda',
              err instanceof Error ? err.message : 'Intente nuevamente.',
            );
          } finally {
            setStartingId(null);
          }
        },
      },
    ]);
  };

  const onLogout = () => {
    Alert.alert('Cerrar sesión', '¿Desea cerrar su sesión en este dispositivo?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Cerrar sesión', style: 'destructive', onPress: () => void logout() },
    ]);
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={routes}
        keyExtractor={(route) => String(route.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} />}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.greeting}>{user?.full_name}</Text>
            <Text style={styles.headerHint}>Seleccione la ruta que va a recorrer.</Text>
            {isOfflineMode() && (
              <View style={{ marginTop: 10 }}>
                <Badge tone="warning" label="Modo de prueba sin servidor" />
              </View>
            )}
            {loadFailed && (
              <View style={{ marginTop: 12 }}>
                <Notice text="No fue posible cargar las rutas. Deslice hacia abajo para reintentar." />
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          refreshing || loadFailed ? null : (
            <EmptyState
              title="No hay rutas activas"
              hint="Deslice hacia abajo para actualizar o consulte con su supervisor."
            />
          )
        }
        renderItem={({ item }) => (
          <Card>
            <Text style={styles.routeName}>{item.name}</Text>
            <View style={styles.facts}>
              <Fact value={String(item.checkpoints.length)} label="checkpoints" />
              <View style={styles.factDivider} />
              <Fact value={`${item.expected_duration_min} min`} label="duración prevista" />
              <View style={styles.factDivider} />
              <Fact value={PATROL_MODE_LABELS[item.patrol_mode]} label="modo" />
            </View>
            <Button
              label="Iniciar ronda"
              busy={startingId === item.id}
              disabled={startingId !== null}
              onPress={() => onStart(item)}
            />
          </Card>
        )}
      />

      <View style={[styles.footer, { paddingBottom: insets.bottom + 8 }]}>
        <TouchableOpacity style={styles.footerItem} onPress={() => navigation.navigate('History')}>
          <Text style={styles.footerLink}>Historial</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.footerItem}
          onPress={() => navigation.navigate('Diagnostics')}
        >
          <Text style={styles.footerLink}>Datos del teléfono</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.footerItem} onPress={onLogout}>
          <Text style={[styles.footerLink, { color: colors.criticalInk }]}>Cerrar sesión</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.plane },
  list: { padding: 16, gap: 12 },
  header: { marginBottom: 4 },
  greeting: { fontSize: 20, fontWeight: '700', color: colors.ink },
  headerHint: { fontSize: 14, color: colors.ink2, marginTop: 2 },
  routeName: { fontSize: 17, fontWeight: '700', color: colors.ink },
  facts: { flexDirection: 'row', alignItems: 'center', marginTop: 12, marginBottom: 16 },
  fact: { flex: 1 },
  factValue: { fontSize: 15, fontWeight: '600', color: colors.ink },
  factLabel: { fontSize: 12, color: colors.muted, marginTop: 1 },
  factDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border, marginHorizontal: 12 },
  footer: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingTop: 4,
  },
  footerItem: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  footerLink: { color: colors.primary, fontWeight: '600', fontSize: 13 },
});
