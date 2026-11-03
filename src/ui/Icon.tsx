// Dependency-free icons drawn with plain Views (no icon font is installed, and
// Unicode glyphs like "▶" render as emoji on some iOS versions).
import { StyleSheet, View } from 'react-native';
import { colors } from './theme';

export type IconName = 'play' | 'pause' | 'next' | 'previous' | 'up' | 'down' | 'close' | 'plus' | 'chevron-down' | 'chevron-right';

type Props = { name: IconName; size?: number; color?: string };

function Triangle({ size, color }: { size: number; color: string }) {
  // right-pointing triangle; width ~0.87 * height
  return (
    <View
      style={{
        width: 0,
        height: 0,
        borderTopWidth: size / 2,
        borderBottomWidth: size / 2,
        borderLeftWidth: size * 0.87,
        borderTopColor: 'transparent',
        borderBottomColor: 'transparent',
        borderLeftColor: color,
      }}
    />
  );
}

function Chevron({ size, color, rotate }: { size: number; color: string; rotate: string }) {
  const s = size * 0.5;
  const w = Math.max(2, size / 9);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: s,
          height: s,
          borderColor: color,
          borderRightWidth: w,
          borderBottomWidth: w,
          // the L-shape's corner sits off-centre; shift it back so the chevron looks centred
          marginTop: rotate === '45deg' ? -s / 3 : rotate === '-135deg' ? s / 3 : 0,
          marginLeft: rotate === '-45deg' ? -s / 3 : 0,
          transform: [{ rotate }],
        }}
      />
    </View>
  );
}

export function Icon({ name, size = 20, color = colors.text }: Props) {
  const box = { width: size, height: size, alignItems: 'center' as const, justifyContent: 'center' as const };
  const bar = Math.max(2, size / 9);
  switch (name) {
    case 'play':
      return (
        <View style={[box, { paddingLeft: size * 0.12 }]}>
          <Triangle size={size * 0.8} color={color} />
        </View>
      );
    case 'pause':
      return (
        <View style={[box, { flexDirection: 'row', gap: size * 0.2 }]}>
          <View style={{ width: size * 0.22, height: size * 0.75, backgroundColor: color, borderRadius: 2 }} />
          <View style={{ width: size * 0.22, height: size * 0.75, backgroundColor: color, borderRadius: 2 }} />
        </View>
      );
    case 'next':
    case 'previous': {
      const flip = name === 'previous';
      return (
        <View style={[box, { flexDirection: 'row', transform: flip ? [{ scaleX: -1 }] : undefined }]}>
          <Triangle size={size * 0.7} color={color} />
          <View style={{ width: size * 0.14, height: size * 0.7, backgroundColor: color, borderRadius: 1.5 }} />
        </View>
      );
    }
    case 'up':
      return <Chevron size={size} color={color} rotate="-135deg" />;
    case 'down':
    case 'chevron-down':
      return <Chevron size={size} color={color} rotate="45deg" />;
    case 'chevron-right':
      return <Chevron size={size} color={color} rotate="-45deg" />;
    case 'close':
    case 'plus': {
      const rot = name === 'close' ? '45deg' : '0deg';
      return (
        <View style={[box, { transform: [{ rotate: rot }] }]}>
          <View style={[styles.abs, { width: size * 0.8, height: bar, backgroundColor: color, borderRadius: bar }]} />
          <View style={[styles.abs, { width: bar, height: size * 0.8, backgroundColor: color, borderRadius: bar }]} />
        </View>
      );
    }
  }
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
});
