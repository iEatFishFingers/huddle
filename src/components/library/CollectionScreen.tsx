import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { library, useLibrary } from '../../library/store';
import type { Song } from '../../library/subsonic';
import { Icon } from '../../ui/Icon';
import { colors, formatTime, MAX_CONTENT_WIDTH, space } from '../../ui/theme';
import { Button } from '../Button';
import { Cover } from './Cover';
import { DownloadButton } from './DownloadButton';
import { RemoteState } from './LibraryScreen';
import { ScreenHeader } from './ScreenHeader';
import { SongRow } from './SongRow';
import { useRemote } from './useRemote';

type Props = {
  kind: 'album' | 'playlist';
  id: string;
  /** Shown while loading. */
  name?: string;
  onBack: () => void;
};

type Loaded = { name: string; byline?: string; coverArt?: string; songs: Song[] };

async function load(kind: Props['kind'], id: string): Promise<Loaded> {
  const client = library.client();
  if (!client) throw new Error('Sign in to your music server first.');
  if (kind === 'album') {
    const { album, songs } = await client.album(id);
    return { name: album.name, byline: [album.artist, album.year].filter(Boolean).join(' · '), coverArt: album.coverArt, songs };
  }
  const { playlist, songs } = await client.playlist(id);
  return { name: playlist.name, byline: playlist.owner ? `Playlist by ${playlist.owner}` : 'Playlist', coverArt: playlist.coverArt, songs };
}

/** An album or playlist on the server: its songs, each downloadable, plus "Download all". */
export function CollectionScreen({ kind, id, name, onBack }: Props) {
  const insets = useSafeAreaInsets();
  const { data, error, loading, reload } = useRemote(`${kind}:${id}`, () => load(kind, id));
  const librarySongs = useLibrary((s) => s.songs);
  const downloads = useLibrary((s) => s.downloads);
  const client = library.client();

  const songs = data?.songs ?? [];
  const missing = songs.filter((s) => !librarySongs.some((d) => d.id === s.id));
  const busy = missing.filter((s) => downloads[s.id] && downloads[s.id].status !== 'error');
  const totalSec = songs.reduce((a, s) => a + (s.duration ?? 0), 0);

  return (
    <View style={styles.screen}>
      <ScreenHeader title={data?.name ?? name ?? ''} onBack={onBack} />
      <ScrollView style={styles.flex} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl * 2 }]}>
        <View style={styles.inner}>
          <RemoteState error={error} loading={loading && !data} onRetry={reload} />
          {data && (
            <>
              <View style={styles.hero}>
                <Cover uri={data.coverArt && client ? client.coverUrl(data.coverArt, 400) : null} label={data.name} size={112} />
                <View style={styles.heroText}>
                  <Text style={styles.title} numberOfLines={2}>
                    {data.name}
                  </Text>
                  {!!data.byline && <Text style={styles.byline}>{data.byline}</Text>}
                  <Text style={styles.meta}>
                    {songs.length} song{songs.length === 1 ? '' : 's'}
                    {totalSec ? ` · ${formatTime(totalSec * 1000)}` : ''}
                  </Text>
                </View>
              </View>

              {songs.length > 0 &&
                (missing.length === 0 ? (
                  <View style={styles.done}>
                    <Icon name="check" size={16} color={colors.accent} />
                    <Text style={styles.doneText}>All downloaded. Ready to play offline.</Text>
                  </View>
                ) : (
                  <Button
                    label={
                      busy.length === missing.length
                        ? `Downloading ${missing.length} song${missing.length === 1 ? '' : 's'}…`
                        : missing.length === songs.length
                          ? `Download all ${songs.length}`
                          : `Download the other ${missing.length}`
                    }
                    disabled={busy.length === missing.length}
                    onPress={() => library.download(missing)}
                    icon={<Icon name="download" size={16} color={colors.onAccent} />}
                  />
                ))}

              <View>
                {songs.map((s, i) => (
                  <SongRow
                    key={`${i}-${s.id}`}
                    title={s.title}
                    subtitle={[kind === 'playlist' ? s.artist : undefined, s.duration ? formatTime(s.duration * 1000) : undefined]
                      .filter(Boolean)
                      .join(' · ')}
                    coverUri={kind === 'album' ? false : s.coverArt && client ? client.coverUrl(s.coverArt, 120) : null}
                    leading={<Text style={styles.num}>{s.track ?? i + 1}</Text>}
                    right={<DownloadButton song={s} />}
                  />
                ))}
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { paddingHorizontal: space.lg, paddingTop: space.lg },
  inner: { width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', gap: space.lg },
  hero: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  heroText: { flex: 1, minWidth: 0, gap: space.xs },
  title: { color: colors.text, fontSize: 22, fontWeight: '800' },
  byline: { color: colors.textDim, fontSize: 14 },
  meta: { color: colors.textMuted, fontSize: 13 },
  done: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 },
  doneText: { color: colors.textDim, fontSize: 14, fontWeight: '600' },
  num: { width: 24, textAlign: 'center', color: colors.textMuted, fontSize: 14, fontVariant: ['tabular-nums'] },
});
