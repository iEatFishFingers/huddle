import { StyleSheet, Text, View } from 'react-native';
import type { Track } from '../protocol';
import { Icon } from '../ui/Icon';
import { avatarColor, colors, radius, space } from '../ui/theme';
import { IconButton } from './Button';
import { SeekBar } from './SeekBar';

type Props = {
  track: Track | null;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  status: string | null;
  canPlay: boolean;
  canNext: boolean;
  onSeek: (ms: number) => void;
  onPlayPause: () => void;
  onPrevious: () => void;
  onNext: () => void;
};

export function NowPlaying(p: Props) {
  const { track } = p;
  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <View style={[styles.art, { backgroundColor: track ? avatarColor(track.id) : colors.surfaceHigh }]}>
          <Text style={styles.artText}>{track ? track.title.slice(0, 1).toUpperCase() : '♪'}</Text>
        </View>
        <View style={styles.meta}>
          <Text style={styles.label}>{track ? (p.playing ? 'Now playing' : 'Paused') : 'Nothing playing'}</Text>
          <Text style={styles.title} numberOfLines={2}>
            {track ? track.title : 'Add a song to get started'}
          </Text>
          {track && (
            <Text style={styles.by} numberOfLines={1}>
              added by {track.addedBy}
            </Text>
          )}
        </View>
      </View>

      <SeekBar positionMs={p.positionMs} durationMs={p.durationMs} onSeek={p.onSeek} disabled={!track} />

      <View style={styles.controls}>
        <IconButton label="Previous" onPress={p.onPrevious} disabled={!track} size={56}>
          <Icon name="previous" size={24} />
        </IconButton>
        <IconButton label={p.playing ? 'Pause' : 'Play'} onPress={p.onPlayPause} disabled={!p.canPlay} size={72} filled>
          <Icon name={p.playing ? 'pause' : 'play'} size={28} color={colors.onAccent} />
        </IconButton>
        <IconButton label="Next" onPress={p.onNext} disabled={!p.canNext} size={56}>
          <Icon name="next" size={24} />
        </IconButton>
      </View>

      <Text style={styles.status} accessibilityLiveRegion="polite">
        {p.status ?? ' '}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, gap: space.md },
  top: { flexDirection: 'row', gap: space.lg, alignItems: 'center' },
  art: { width: 76, height: 76, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  artText: { color: 'rgba(255,255,255,0.9)', fontSize: 32, fontWeight: '800' },
  meta: { flex: 1, minWidth: 0, gap: 2 },
  label: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  title: { color: colors.text, fontSize: 20, fontWeight: '800', lineHeight: 25 },
  by: { color: colors.textDim, fontSize: 13 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xl },
  status: { color: colors.textDim, fontSize: 13, textAlign: 'center', minHeight: 18 },
});
