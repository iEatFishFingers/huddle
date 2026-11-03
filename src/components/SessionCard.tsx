import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NearbySession } from '../discovery';
import { Avatar } from './Avatar';
import { Icon } from '../ui/Icon';
import { colors, radius, space } from '../ui/theme';

export function SessionCard({ session, onPress }: { session: NearbySession; onPress: () => void }) {
  const full = session.members >= session.maxMembers;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Join ${session.sessionName}, hosted by ${session.hostName}`}
      accessibilityHint={full ? 'This session is full' : undefined}
      accessibilityState={{ disabled: full }}
      disabled={full}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed, full && styles.full]}
    >
      <Avatar name={session.hostName} seed={session.id} size={44} ring={colors.surface} />
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {session.sessionName}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          hosted by {session.hostName}
        </Text>
      </View>
      <View style={styles.right}>
        <Text style={[styles.count, full && { color: colors.textMuted }]}>
          {full ? 'Full' : `${session.members}/${session.maxMembers}`}
        </Text>
        {!full && <Icon name="chevron-right" size={16} color={colors.textMuted} />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.md,
    minHeight: 68,
  },
  pressed: { backgroundColor: colors.surfacePressed },
  full: { opacity: 0.5 },
  body: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 16, fontWeight: '700' },
  meta: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  right: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  count: { color: colors.accent, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
