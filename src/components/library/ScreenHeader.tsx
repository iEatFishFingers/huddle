import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../ui/Icon';
import { colors, MAX_CONTENT_WIDTH, space } from '../../ui/theme';
import { IconButton } from '../Button';

export function ScreenHeader({ title, onBack, right }: { title: string; onBack: () => void; right?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
      <View style={styles.inner}>
        <IconButton label="Back" onPress={onBack}>
          <Icon name="chevron-left" size={20} />
        </IconButton>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {right}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  inner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' },
  title: { flex: 1, color: colors.text, fontSize: 20, fontWeight: '800' },
});
