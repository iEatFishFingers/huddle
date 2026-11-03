import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, Text, ViewStyle } from 'react-native';
import { colors, HIT, radius, space } from '../ui/theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: 'md' | 'lg';
  disabled?: boolean;
  busy?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
};

export function Button({ label, onPress, variant = 'primary', size = 'md', disabled, busy, icon, style, accessibilityHint }: Props) {
  const inactive = disabled || busy;
  const textColor =
    variant === 'primary' ? colors.onAccent : variant === 'danger' ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!busy }}
      disabled={inactive}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.base,
        size === 'lg' && styles.lg,
        variantStyles[variant],
        pressed && pressedStyles[variant],
        inactive && styles.disabled,
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={textColor} /> : icon}
      <Text style={[styles.label, size === 'lg' && styles.labelLg, { color: textColor }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Round icon-only button (transport controls, row actions). */
export function IconButton({
  children,
  onPress,
  label,
  size = HIT,
  filled,
  disabled,
  style,
}: {
  children: ReactNode;
  onPress: () => void;
  label: string;
  size?: number;
  filled?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={Math.max(0, (HIT - size) / 2)}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: filled ? (pressed ? colors.accentPressed : colors.accent) : pressed ? colors.surfacePressed : 'transparent',
          transform: [{ scale: pressed ? 0.94 : 1 }],
        },
        disabled && styles.disabled,
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: HIT,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  lg: { minHeight: 56, paddingHorizontal: space.xl },
  label: { fontSize: 15, fontWeight: '700' },
  labelLg: { fontSize: 17 },
  disabled: { opacity: 0.4 },
});

const variantStyles = StyleSheet.create({
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.surfaceHigh },
  ghost: { backgroundColor: 'transparent' },
  danger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
});

const pressedStyles = StyleSheet.create({
  primary: { backgroundColor: colors.accentPressed },
  secondary: { backgroundColor: colors.surfacePressed },
  ghost: { backgroundColor: colors.surfaceHigh },
  danger: { backgroundColor: colors.surfaceHigh },
});
