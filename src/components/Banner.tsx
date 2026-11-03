import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../ui/Icon';
import { colors, HIT, radius, space } from '../ui/theme';

type Props = {
  text: string;
  tone?: 'info' | 'warn';
  onDismiss?: () => void;
};

/** Gentle inline notice (errors that aren't fatal, hints). */
export function Banner({ text, tone = 'info', onDismiss }: Props) {
  const fg = tone === 'warn' ? colors.warnText : colors.infoText;
  return (
    <View
      accessibilityRole="alert"
      style={[styles.banner, { backgroundColor: tone === 'warn' ? colors.warnBg : colors.info }]}
    >
      <Text style={[styles.text, { color: fg }]}>{text}</Text>
      {onDismiss && (
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={onDismiss} hitSlop={8} style={styles.close}>
          <Icon name="close" size={14} color={fg} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    paddingLeft: space.lg,
    paddingVertical: space.sm,
    minHeight: HIT,
    gap: space.sm,
  },
  text: { flex: 1, fontSize: 13, lineHeight: 18, paddingRight: space.lg },
  close: { width: HIT, height: HIT, marginVertical: -space.sm, alignItems: 'center', justifyContent: 'center' },
});
