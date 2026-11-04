import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { colors, radius, space } from '../../ui/theme';

/** Row of pill tabs. */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string }[]; value: T; onChange: (key: T) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} accessibilityRole="tablist">
      {tabs.map((t) => {
        const on = t.key === value;
        return (
          <Pressable
            key={t.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(t.key)}
            style={({ pressed }) => [styles.tab, on && styles.on, pressed && !on && styles.pressed]}
          >
            <Text style={[styles.label, on && styles.labelOn]}>{t.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.sm },
  tab: { minHeight: 36, paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: colors.surfaceHigh, justifyContent: 'center' },
  on: { backgroundColor: colors.accent },
  pressed: { backgroundColor: colors.surfacePressed },
  label: { color: colors.text, fontSize: 14, fontWeight: '600' },
  labelOn: { color: colors.onAccent, fontWeight: '700' },
});
