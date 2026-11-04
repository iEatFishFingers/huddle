import { useMemo, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { filterSongs, library, LibrarySong, useLibrary } from '../../library/store';
import { Icon } from '../../ui/Icon';
import { colors, MAX_CONTENT_WIDTH, radius, space } from '../../ui/theme';
import { Button, IconButton } from '../Button';
import { TextField } from '../TextField';
import { SelectMark, SongRow } from './SongRow';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Add these downloaded songs to the session. */
  onAdd: (songs: LibrarySong[]) => void;
  /** Fall back to the system file picker. */
  onPickFiles: () => void;
};

/** "Add songs" sheet in a session: pick from the offline library, or from files. Works with no internet. */
export function LibraryPicker({ visible, onClose, onAdd, onPickFiles }: Props) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {/* remount each time it opens so the selection starts empty */}
      {visible && <PickerBody onClose={onClose} onAdd={onAdd} onPickFiles={onPickFiles} />}
    </Modal>
  );
}

function PickerBody({ onClose, onAdd, onPickFiles }: Omit<Props, 'visible'>) {
  const insets = useSafeAreaInsets();
  const songs = useLibrary((s) => s.songs);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const shown = useMemo(() => filterSongs(songs, filter), [songs, filter]);
  const allShownSelected = shown.length > 0 && shown.every((s) => selected.includes(s.id));

  const toggle = (id: string) => setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));
  const toggleAll = () =>
    setSelected((sel) =>
      allShownSelected ? sel.filter((id) => !shown.some((s) => s.id === id)) : [...sel, ...shown.map((s) => s.id).filter((id) => !sel.includes(id))],
    );

  const add = () => {
    const picked = selected.map((id) => songs.find((s) => s.id === id)).filter((s): s is LibrarySong => !!s);
    onClose();
    onAdd(picked);
  };
  const files = () => {
    onClose();
    // let the sheet finish closing first; iOS won't present the file picker over a closing modal
    setTimeout(onPickFiles, Platform.OS === 'ios' ? 450 : 0);
  };

  return (
    <View style={[styles.screen, { paddingTop: Platform.OS === 'ios' ? space.md : insets.top + space.md }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Add songs</Text>
        <IconButton label="Close" onPress={onClose}>
          <Icon name="close" size={16} />
        </IconButton>
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.inner}>
          {songs.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Your library is empty</Text>
              <Text style={styles.emptyText}>
                To have music with no internet, open Music library on the home screen, connect your Navidrome server and download
                songs before you go offline.
              </Text>
            </View>
          ) : (
            <>
              <Text style={styles.label}>From your library · works offline</Text>
              {songs.length > 8 && (
                <TextField value={filter} onChangeText={setFilter} placeholder="Filter songs" autoCorrect={false} returnKeyType="search" />
              )}
              {shown.length > 1 && (
                <Button label={allShownSelected ? 'Select none' : `Select all ${shown.length}`} variant="ghost" onPress={toggleAll} style={styles.selectAll} />
              )}
              <View>
                {shown.map((s) => {
                  const on = selected.includes(s.id);
                  return (
                    <SongRow
                      key={s.id}
                      title={s.title}
                      subtitle={[s.artist, s.album].filter(Boolean).join(' · ')}
                      coverUri={library.coverUri(s)}
                      selected={on}
                      onPress={() => toggle(s.id)}
                      right={<SelectMark selected={on} />}
                    />
                  );
                })}
              </View>
            </>
          )}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>
        <View style={[styles.inner, styles.footerRow]}>
          <Button label="From files" variant="secondary" onPress={files} style={styles.flex} />
          {songs.length > 0 && (
            <Button
              label={selected.length ? `Add ${selected.length} song${selected.length === 1 ? '' : 's'}` : 'Add'}
              disabled={!selected.length}
              onPress={add}
              style={styles.flex}
            />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH + space.lg * 2,
    alignSelf: 'center',
  },
  title: { color: colors.text, fontSize: 22, fontWeight: '800' },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xl },
  inner: { width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', gap: space.md },
  label: { color: colors.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  selectAll: { alignSelf: 'flex-start', paddingHorizontal: space.sm },
  footer: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  footerRow: { flexDirection: 'row', gap: space.sm },
  empty: {
    alignItems: 'center',
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    gap: space.xs,
    marginTop: space.md,
  },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  emptyText: { color: colors.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 18 },
});
