import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { colors, space } from '../ui/theme';

/** Small pulsing "Scanning…" indicator. */
export function ScanningDot({ active }: { active: boolean }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, pulse]);

  if (!active) return null;
  return (
    <View style={styles.row} accessibilityLabel="Scanning for nearby sessions">
      <Animated.View
        style={[
          styles.dot,
          { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) },
          { transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.2] }) }] },
        ]}
      />
      <Text style={styles.text}>Scanning</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs + 2 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  text: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
});
