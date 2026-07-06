import { useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { api } from '../api/client';
import type { SessionListItem } from '../api/types';
import { formatDateTime, STATUS_LABELS } from '../lib/labels';

const STATUS_COLORS: Record<SessionListItem['status'], string> = {
  in_progress: '#2a78d6',
  completed: '#0ca30c',
  abandoned: '#d03b3b',
};

export function HistoryScreen() {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    try {
      setSessions(await api<SessionListItem[]>('/sessions/mine'));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <FlatList
      style={styles.list}
      data={sessions}
      keyExtractor={(session) => String(session.id)}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} />}
      contentContainerStyle={{ padding: 16, gap: 8 }}
      ListEmptyComponent={<Text style={styles.empty}>Aún no tienes rondas registradas.</Text>}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.route}>{item.route_name}</Text>
            <Text style={[styles.status, { color: STATUS_COLORS[item.status] }]}>
              {STATUS_LABELS[item.status]}
            </Text>
          </View>
          <Text style={styles.meta}>
            Inicio: {formatDateTime(item.started_at)}
            {item.ended_at ? ` · Fin: ${formatDateTime(item.ended_at)}` : ''}
          </Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { backgroundColor: '#f9f9f7' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, elevation: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  route: { fontSize: 15, fontWeight: '600', color: '#0b0b0b' },
  status: { fontSize: 13, fontWeight: '700' },
  meta: { fontSize: 12, color: '#898781', marginTop: 4 },
  empty: { textAlign: 'center', color: '#898781', marginTop: 48 },
});
