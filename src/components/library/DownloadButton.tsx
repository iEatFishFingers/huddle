import { Pressable, StyleSheet, Text, View } from 'react-native';
import { library, useLibrary } from '../../library/store';
import type { Song } from '../../library/subsonic';
import { Icon } from '../../ui/Icon';
import { colors, HIT, space } from '../../ui/theme';

/** Per-song download control: download → progress (tap to cancel) → downloaded tick; retry on failure. */
export function DownloadButton({ song }: { song: Song }) {
  const downloaded = useLibrary((s) => s.songs.some((x) => x.id === song.id));
  const job = useLibrary((s) => s.downloads[song.id]);

  if (downloaded) {
    return (
      <View style={styles.box} accessible accessibilityLabel={`${song.title} is downloaded`}>
        <Icon name="check" size={18} color={colors.accent} />
      </View>
    );
  }
  if (job?.status === 'error') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Download of ${song.title} failed: ${job.error ?? ''}. Retry`}
        onPress={() => library.download([song])}
        style={({ pressed }) => [styles.box, pressed && styles.pressed]}
        hitSlop={4}
      >
        <Text style={styles.retry}>Retry</Text>
      </Pressable>
    );
  }
  if (job) {
    const label = job.status === 'queued' ? 'Waiting' : `${Math.round(job.fraction * 100)}%`;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Downloading ${song.title}, ${label}. Cancel`}
        onPress={() => library.cancel(song.id)}
        style={({ pressed }) => [styles.box, pressed && styles.pressed]}
        hitSlop={4}
      >
        <Text style={styles.progress}>{label}</Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Download ${song.title}`}
      onPress={() => library.download([song])}
      style={({ pressed }) => [styles.box, pressed && styles.pressed]}
      hitSlop={4}
    >
      <Icon name="download" size={18} color={colors.textDim} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { minWidth: HIT + 8, height: HIT, alignItems: 'center', justifyContent: 'center', borderRadius: HIT / 2, paddingHorizontal: space.xs },
  pressed: { backgroundColor: 'rgba(255,255,255,0.08)' },
  progress: { color: colors.accent, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  retry: { color: colors.warnText, fontSize: 12, fontWeight: '700' },
});
