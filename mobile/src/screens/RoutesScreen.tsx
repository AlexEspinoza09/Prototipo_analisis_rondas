import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { api } from '../api/client';
import type { RouteItem } from '../api/types';
import type { RootStackParamList } from '../App';
import { useAuth } from '../auth/AuthContext';
import { usePatrol } from '../patrol/PatrolContext';

type Props = NativeStackScreenProps<RootStackParamList, 'Routes'>;

export function RoutesScreen({ navigation }: Props) {
  const { user, logout } = useAuth();
  const { startPatrol } = usePatrol();
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);

  const load = async () => {
    setRefreshing(true);
    try {
      const all = await api<RouteItem[]>('/routes');
      setRoutes(all.filter((route) => route.is_active));
    } catch {
      Alert.alert('Error', 'No se pudieron cargar las rutas.');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const onStart = (route: RouteItem) => {
    Alert.alert('Iniciar ronda', `¿Iniciar la ronda "${route.name}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Iniciar',
        onPress: async () => {
          setStarting(true);
          try {
            await startPatrol(route, `${user?.id ?? 'guard'}-device`);
          } catch (err) {
            Alert.alert('No se pudo iniciar', err instanceof Error ? err.message : 'Error');
          } finally {
            setStarting(false);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={routes}
        keyExtractor={(route) => String(route.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} />}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        ListEmptyComponent={
          <Text style={styles.empty}>No hay rutas activas. Desliza para recargar.</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.routeName}>{item.name}</Text>
            <Text style={styles.routeMeta}>
              {item.checkpoints.length} checkpoints · {item.expected_duration_min} min estimados
            </Text>
            <TouchableOpacity
              style={[styles.button, starting && { opacity: 0.6 }]}
              disabled={starting}
              onPress={() => onStart(item)}
            >
              <Text style={styles.buttonText}>Iniciar ronda</Text>
            </TouchableOpacity>
          </View>
        )}
      />
      <View style={styles.footer}>
        <TouchableOpacity onPress={() => navigation.navigate('History')}>
          <Text style={styles.footerLink}>Historial</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => void logout()}>
          <Text style={[styles.footerLink, { color: '#d03b3b' }]}>Cerrar sesión</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9f9f7' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, elevation: 1 },
  routeName: { fontSize: 17, fontWeight: '600', color: '#0b0b0b' },
  routeMeta: { fontSize: 13, color: '#898781', marginTop: 2, marginBottom: 12 },
  button: {
    backgroundColor: '#2a78d6',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '600' },
  empty: { textAlign: 'center', color: '#898781', marginTop: 48 },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#e1e0d9',
    backgroundColor: '#fff',
  },
  footerLink: { color: '#2a78d6', fontWeight: '600' },
});
