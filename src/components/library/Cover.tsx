import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { avatarColor, colors, radius } from '../../ui/theme';

/** Album art, or a coloured tile with the first letter when there's none (or it fails to load). */
export function Cover({ uri, label, size = 48 }: { uri?: string | null; label: string; size?: number }) {
  const [failed, setFailed] = useState<string | null>(null);
  const r = size >= 96 ? radius.md : radius.sm;
  if (uri && failed !== uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: r, backgroundColor: colors.surfaceHigh }}
        onError={() => setFailed(uri)}
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: r, backgroundColor: avatarColor(label) }]}>
      <Text style={[styles.letter, { fontSize: size * 0.4 }]}>{(label.trim()[0] ?? '♪').toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center' },
  letter: { color: 'rgba(255,255,255,0.85)', fontWeight: '800' },
});
