import { StyleSheet, View } from 'react-native';
import { colors } from '../ui/theme';

export function ProgressBar({ fraction, height = 4 }: { fraction: number; height?: number }) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}
      style={[styles.track, { height, borderRadius: height / 2 }]}
    >
      <View style={[styles.fill, { width: `${pct}%`, borderRadius: height / 2 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { backgroundColor: colors.track, overflow: 'hidden', width: '100%' },
  fill: { height: '100%', backgroundColor: colors.accent },
});
