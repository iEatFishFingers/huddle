import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, space } from '../ui/theme';

const VISIBLE_MS = 2500;
const FADE_MS = 180;

/** Queue of transient messages; show one at a time. */
export function useToastQueue() {
  const [queue, setQueue] = useState<{ id: number; text: string }[]>([]);
  const nextId = useRef(0);
  const push = useCallback((text: string) => {
    setQueue((q) => [...q.slice(-4), { id: nextId.current++, text }]);
  }, []);
  const shift = useCallback(() => setQueue((q) => q.slice(1)), []);
  return { current: queue[0] ?? null, push, shift };
}

/** Bottom toast that slides in, stays ~2.5 s, then calls onHidden. */
export function Toast({ toast, onHidden, bottomOffset = 0 }: { toast: { id: number; text: string } | null; onHidden: () => void; bottomOffset?: number }) {
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!toast) return;
    anim.setValue(0);
    const seq = Animated.sequence([
      Animated.timing(anim, { toValue: 1, duration: FADE_MS, useNativeDriver: true }),
      Animated.delay(VISIBLE_MS),
      Animated.timing(anim, { toValue: 0, duration: FADE_MS, useNativeDriver: true }),
    ]);
    seq.start(({ finished }) => finished && onHidden());
    return () => seq.stop();
  }, [toast, anim, onHidden]);

  if (!toast) return null;
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[
        styles.toast,
        {
          bottom: insets.bottom + space.lg + bottomOffset,
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
        },
      ]}
    >
      <Text style={styles.text} numberOfLines={2}>
        {toast.text}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    alignSelf: 'center',
    maxWidth: 480,
    backgroundColor: '#f2f2f2',
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  text: { color: '#121212', fontSize: 14, fontWeight: '600', textAlign: 'center' },
});
