import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, radius } from '../theme';

type ButtonVariant = 'primary' | 'secondary' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  busy = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: 'md' | 'lg';
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const textColor = variant === 'primary' ? '#fff' : variant === 'danger' ? colors.criticalInk : colors.ink;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      activeOpacity={0.85}
      disabled={disabled || busy}
      onPress={onPress}
      style={[
        styles.button,
        size === 'lg' && styles.buttonLg,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        (disabled || busy) && styles.buttonDisabled,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text style={[styles.buttonText, size === 'lg' && styles.buttonTextLg, { color: textColor }]}>
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export type Tone = 'neutral' | 'info' | 'good' | 'warning' | 'critical';

const TONES: Record<Tone, { bg: string; fg: string; dot: string }> = {
  neutral: { bg: colors.plane, fg: colors.ink2, dot: colors.muted },
  info: { bg: colors.primarySoft, fg: colors.primary, dot: colors.primary },
  good: { bg: colors.goodSoft, fg: colors.goodInk, dot: colors.good },
  warning: { bg: colors.warningSoft, fg: colors.warningInk, dot: colors.warning },
  critical: { bg: colors.criticalSoft, fg: colors.criticalInk, dot: colors.critical },
};

/** Status label: dot + text, so state is never encoded by color alone. */
export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const t = TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      <View style={[styles.badgeDot, { backgroundColor: t.dot }]} />
      <Text style={[styles.badgeText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

export function Notice({ text, tone = 'critical' }: { text: string; tone?: 'critical' | 'info' | 'warning' }) {
  const t = TONES[tone];
  return (
    <View style={[styles.notice, { backgroundColor: t.bg, borderColor: t.dot }]}>
      <Text style={[styles.noticeText, { color: t.fg }]}>{text}</Text>
    </View>
  );
}

/** Label / value line for summaries and diagnostics. */
export function DataRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.dataRow, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.dataLabel}>{label}</Text>
      <Text style={styles.dataValue}>{value}</Text>
    </View>
  );
}

export function SectionTitle({ children }: { children: string }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint && <Text style={styles.emptyHint}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 46,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  buttonLg: { minHeight: 56 },
  buttonPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  buttonSecondary: { backgroundColor: colors.surface, borderColor: colors.border },
  buttonDanger: { backgroundColor: colors.surface, borderColor: colors.critical },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontSize: 15, fontWeight: '600' },
  buttonTextLg: { fontSize: 17, fontWeight: '700' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  notice: { borderRadius: radius.md, borderLeftWidth: 3, paddingHorizontal: 12, paddingVertical: 10 },
  noticeText: { fontSize: 13, lineHeight: 18 },
  dataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dataLabel: { fontSize: 13, color: colors.ink2, flexShrink: 1 },
  dataValue: { fontSize: 14, fontWeight: '600', color: colors.ink, fontVariant: ['tabular-nums'] },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  empty: { alignItems: 'center', paddingVertical: 56, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: colors.ink2, textAlign: 'center' },
  emptyHint: { fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 6 },
});
