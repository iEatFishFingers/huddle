// Pure-JS seek bar: drag (or tap) anywhere on the bar, see a preview time, and one
// seek is sent on release.
import { useEffect, useMemo, useRef, useState } from 'react';
import { GestureResponderEvent, LayoutChangeEvent, PanResponder, StyleSheet, Text, View } from 'react-native';
import { colors, formatTime, space } from '../ui/theme';

type Props = {
  positionMs: number;
  durationMs: number;
  onSeek: (positionMs: number) => void;
  disabled?: boolean;
};

const TRACK_H = 4;
const THUMB = 14;
const TOUCH_H = 44;
/** After release, keep showing the target until the host's state catches up (or this long). */
const HOLD_MS = 2000;

export function SeekBar({ positionMs, durationMs, onSeek, disabled }: Props) {
  const [width, setWidth] = useState(0);
  const [dragMs, setDragMs] = useState<number | null>(null);
  const [held, setHeld] = useState<{ ms: number; at: number } | null>(null);
  const canSeek = !disabled && durationMs > 0;

  // PanResponder is created once; read live values through a ref.
  const live = useRef({ width, durationMs, canSeek, onSeek, startX: 0 });
  useEffect(() => {
    Object.assign(live.current, { width, durationMs, canSeek, onSeek });
  }, [width, durationMs, canSeek, onSeek]);

  const pan = useMemo(() => {
    const msAt = (x: number) => {
      const { width: w, durationMs: d } = live.current;
      if (w <= 0) return 0;
      return Math.round(Math.max(0, Math.min(1, x / w)) * d);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => live.current.canSeek,
      onMoveShouldSetPanResponder: () => live.current.canSeek,
      // don't let a parent ScrollView steal a horizontal drag
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e: GestureResponderEvent) => {
        live.current.startX = e.nativeEvent.locationX;
        setDragMs(msAt(live.current.startX));
      },
      onPanResponderMove: (_e, g) => setDragMs(msAt(live.current.startX + g.dx)),
      onPanResponderRelease: (_e, g) => {
        const ms = msAt(live.current.startX + g.dx);
        setDragMs(null);
        setHeld({ ms, at: Date.now() });
        live.current.onSeek(ms);
      },
      onPanResponderTerminate: () => setDragMs(null),
    });
  }, []);

  // drop the held value once playback reports a nearby position (or it times out)
  useEffect(() => {
    if (!held) return;
    if (Math.abs(positionMs - held.ms) < 1500 || Date.now() - held.at > HOLD_MS) setHeld(null);
  }, [positionMs, held]);

  const shownMs = dragMs ?? held?.ms ?? positionMs;
  const clamped = durationMs > 0 ? Math.min(shownMs, durationMs) : shownMs;
  const fraction = durationMs > 0 ? clamped / durationMs : 0;
  const dragging = dragMs !== null;

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <View>
      <View
        {...pan.panHandlers}
        onLayout={onLayout}
        style={styles.touch}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Seek"
        accessibilityValue={{ text: `${formatTime(clamped)} of ${durationMs > 0 ? formatTime(durationMs) : 'unknown'}` }}
        accessibilityActions={canSeek ? [{ name: 'increment' }, { name: 'decrement' }] : []}
        onAccessibilityAction={(e) => {
          const step = 10_000;
          const next = e.nativeEvent.actionName === 'increment' ? clamped + step : clamped - step;
          onSeek(Math.max(0, Math.min(durationMs, next)));
        }}
      >
        <View style={styles.track} pointerEvents="none">
          <View style={[styles.fill, { width: `${fraction * 100}%` }, !canSeek && styles.fillOff]} />
        </View>
        {canSeek && (
          <View
            pointerEvents="none"
            style={[
              styles.thumb,
              dragging && styles.thumbActive,
              { left: fraction * width - (dragging ? THUMB * 1.4 : THUMB) / 2 },
            ]}
          />
        )}
      </View>
      <View style={styles.times} pointerEvents="none">
        <Text style={[styles.time, dragging && styles.timeActive]}>{formatTime(clamped)}</Text>
        <Text style={styles.time}>{durationMs > 0 ? `-${formatTime(durationMs - clamped)}` : '--:--'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  touch: { height: TOUCH_H, justifyContent: 'center' },
  track: { height: TRACK_H, borderRadius: TRACK_H / 2, backgroundColor: colors.track, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.text },
  fillOff: { backgroundColor: colors.textMuted },
  thumb: {
    position: 'absolute',
    top: (TOUCH_H - THUMB) / 2,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.text,
  },
  thumbActive: {
    width: THUMB * 1.4,
    height: THUMB * 1.4,
    borderRadius: (THUMB * 1.4) / 2,
    top: (TOUCH_H - THUMB * 1.4) / 2,
    backgroundColor: colors.accent,
  },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -space.xs },
  time: { color: colors.textMuted, fontSize: 12, fontVariant: ['tabular-nums'] },
  timeActive: { color: colors.accent, fontWeight: '700' },
});
