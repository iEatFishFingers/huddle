import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../ui/Icon';
import { colors, HIT, radius, space } from '../ui/theme';
import { IconButton } from './Button';

type Props = {
  index: number;
  title: string;
  addedBy: string;
  isFirst: boolean;
  isLast: boolean;
  onPlay: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
};

export function QueueRow({ index, title, addedBy, isFirst, isLast, onPlay, onMoveUp, onMoveDown, onRemove }: Props) {
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Play ${title} now`}
        onPress={onPlay}
        style={({ pressed }) => [styles.main, pressed && styles.pressed]}
      >
        <Text style={styles.num}>{index + 1}</Text>
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            added by {addedBy}
          </Text>
        </View>
      </Pressable>
      <View style={styles.actions}>
        <IconButton label={`Move ${title} up`} onPress={onMoveUp} disabled={isFirst} size={36}>
          <Icon name="up" size={16} color={colors.textDim} />
        </IconButton>
        <IconButton label={`Move ${title} down`} onPress={onMoveDown} disabled={isLast} size={36}>
          <Icon name="down" size={16} color={colors.textDim} />
        </IconButton>
        <IconButton label={`Remove ${title} from queue`} onPress={onRemove} size={36}>
          <Icon name="close" size={14} color={colors.textDim} />
        </IconButton>
      </View>
    </View>
  );
}

/** Simpler row for already-played tracks; tap re-queues. */
export function HistoryRow({ title, addedBy, onRequeue }: { title: string; addedBy: string; onRequeue: () => void }) {
  return (
    <View style={styles.row}>
      <View style={[styles.main, { paddingLeft: space.md }]}>
        <View style={styles.text}>
          <Text style={[styles.title, { color: colors.textDim }]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            added by {addedBy}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <IconButton label={`Add ${title} to the queue again`} onPress={onRequeue} size={36}>
          <Icon name="plus" size={14} color={colors.textDim} />
        </IconButton>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 60 },
  main: {
    flex: 1,
    minWidth: 0,
    minHeight: HIT + 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.sm,
    paddingRight: space.sm,
  },
  pressed: { backgroundColor: colors.surfacePressed },
  num: { width: 28, textAlign: 'center', color: colors.textMuted, fontSize: 14, fontVariant: ['tabular-nums'] },
  text: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  meta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
});
