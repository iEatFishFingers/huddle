import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, HIT, radius, space } from '../../ui/theme';
import { Cover } from './Cover';

type Props = {
  title: string;
  subtitle?: string;
  /** Cover image; pass `false` to hide the cover and show `leading` (e.g. a track number) instead. */
  coverUri?: string | null | false;
  leading?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  selected?: boolean;
  accessibilityLabel?: string;
};

export function SongRow({ title, subtitle, coverUri, leading, right, onPress, selected, accessibilityLabel }: Props) {
  return (
    <View style={[styles.row, selected && styles.selected]}>
      <Pressable
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={accessibilityLabel ?? [title, subtitle].filter(Boolean).join(', ')}
        accessibilityState={selected !== undefined ? { selected } : undefined}
        disabled={!onPress}
        onPress={onPress}
        style={({ pressed }) => [styles.main, pressed && styles.pressed]}
      >
        {coverUri === false ? leading : <Cover uri={coverUri} label={title} size={44} />}
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {!!subtitle && (
            <Text style={styles.meta} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </View>
      </Pressable>
      {right}
    </View>
  );
}

/** Round tick box for multi-select lists. */
export function SelectMark({ selected }: { selected: boolean }) {
  return (
    <View style={[styles.mark, selected && styles.markOn]}>
      {selected && <View style={styles.tick} />}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 60, borderRadius: radius.md },
  selected: { backgroundColor: colors.surface },
  main: {
    flex: 1,
    minWidth: 0,
    minHeight: HIT + 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
  },
  pressed: { backgroundColor: colors.surfacePressed },
  text: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  meta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  mark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.md,
  },
  markOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  tick: {
    width: 7,
    height: 12,
    borderColor: colors.onAccent,
    borderRightWidth: 2.5,
    borderBottomWidth: 2.5,
    marginTop: -2,
    transform: [{ rotate: '45deg' }],
  },
});
