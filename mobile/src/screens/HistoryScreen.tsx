import { useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { api } from '../api/client';
import type { SessionListItem } from '../api/types';
import { Badge, Card, EmptyState, Notice, type Tone } from '../components/ui';
import { formatDateTime, STATUS_LABELS } from '../lib/labels';
import { colors } from '../theme';

const STATUS_TONE: Record<SessionListItem['status'], Tone> = {
  in_progress: 'info',
  completed: 'good',
  abandoned: 'critical',
};

function duration(session: SessionListItem): string {
  if (!session.ended_at) return 'En curso';
  const minutes = Math.round(
    (new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 60_000,
  );
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function HistoryScreen() {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = async () => {
    setRefreshing(true);
    try {
      setSessions(await api<SessionListItem[]>('/sessions/mine'));
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

  return (
    <FlatList
      style={styles.list}
      data={sessions}
      keyExtractor={(session) => String(session.id)}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} />}
      contentContainerStyle={{ padding: 16, gap: 10 }}
      ListHeaderComponent={
        loadFailed ? (
          <Notice text="No fue posible cargar el historial. Deslice hacia abajo para reintentar." />
        ) : null
      }
      ListEmptyComponent={
        refreshing || loadFailed ? null : (
          <EmptyState
            title="Aún no tiene rondas registradas"
            hint="Las rondas que realice aparecerán en esta lista."
          />
        )
      }
      renderItem={({ item }) => (
        <Card>
          <View style={styles.row}>
            <Text style={styles.route} numberOfLines={1}>
              {item.route_name}
            </Text>
            <Badge label={STATUS_LABELS[item.status]} tone={STATUS_TONE[item.status]} />
          </View>
          <View style={styles.metaRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.metaLabel}>Inicio</Text>
              <Text style={styles.metaValue}>{formatDateTime(item.started_at)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.metaLabel}>Fin</Text>
              <Text style={styles.metaValue}>
                {item.ended_at ? formatDateTime(item.ended_at) : '—'}
              </Text>
            </View>
            <View>
              <Text style={styles.metaLabel}>Duración</Text>
              <Text style={styles.metaValue}>{duration(item)}</Text>
            </View>
          </View>
        </Card>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { backgroundColor: colors.plane },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  route: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.ink },
  metaRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  metaLabel: { fontSize: 12, color: colors.muted },
  metaValue: { fontSize: 13, fontWeight: '600', color: colors.ink, marginTop: 1 },
});
