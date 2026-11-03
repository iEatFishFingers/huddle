import { StyleSheet, Text, View } from 'react-native';
import type { Member } from '../protocol';
import { avatarColor, colors, initials } from '../ui/theme';

export function Avatar({ name, seed, size = 32, ring }: { name: string; seed?: string; size?: number; ring?: string }) {
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: avatarColor(seed ?? name),
          borderColor: ring ?? colors.bg,
        },
      ]}
    >
      <Text style={[styles.text, { fontSize: size * 0.38 }]}>{initials(name)}</Text>
    </View>
  );
}

/** Overlapping avatar stack for the session header. */
export function MemberStack({ members, you }: { members: Member[]; you: string | null }) {
  return (
    <View style={styles.stack} accessibilityLabel={`${members.length} listening: ${members.map((m) => m.name).join(', ')}`}>
      {members.map((m, i) => (
        <View key={m.id} style={{ marginLeft: i === 0 ? 0 : -8, zIndex: members.length - i }}>
          <Avatar name={m.name} seed={m.id} size={30} ring={m.id === you ? colors.accent : colors.bg} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  text: { color: '#fff', fontWeight: '800' },
  stack: { flexDirection: 'row', alignItems: 'center' },
});
