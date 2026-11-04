import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { filterSongs, formatBytes, library, useLibrary } from '../../library/store';
import type { Album, AlbumListType, Playlist } from '../../library/subsonic';
import { Icon } from '../../ui/Icon';
import { colors, MAX_CONTENT_WIDTH, radius, space } from '../../ui/theme';
import { Banner } from '../Banner';
import { Button, IconButton } from '../Button';
import { ProgressBar } from '../ProgressBar';
import { TextField } from '../TextField';
import { DownloadButton } from './DownloadButton';
import { ScreenHeader } from './ScreenHeader';
import { SongRow } from './SongRow';
import { Tabs } from './Tabs';
import { useRemote } from './useRemote';

type Tab = 'phone' | 'albums' | 'playlists' | 'search';

type Props = {
  onBack: () => void;
  onOpen: (kind: 'album' | 'playlist', id: string, name: string) => void;
};

const PAGE = 60;

function confirmRemove(title: string, onOk: () => void) {
  if (Platform.OS === 'web') {
    if (globalThis.confirm?.(`Remove "${title}" from this phone?`) ?? true) onOk();
    return;
  }
  Alert.alert('Remove from this phone?', title, [
    { text: 'Keep', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: onOk },
  ]);
}

export function LibraryScreen({ onBack, onOpen }: Props) {
  const insets = useSafeAreaInsets();
  const server = useLibrary((s) => s.server);
  const songCount = useLibrary((s) => s.songs.length);
  const [tab, setTab] = useState<Tab>(() => (library.get().server && library.get().songs.length === 0 ? 'albums' : 'phone'));

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Music library" onBack={onBack} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.flex}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl * 2 }]}
        >
          <View style={styles.inner}>
            <Tabs<Tab>
              value={tab}
              onChange={setTab}
              tabs={[
                { key: 'phone', label: songCount ? `On this phone (${songCount})` : 'On this phone' },
                { key: 'albums', label: 'Albums' },
                { key: 'playlists', label: 'Playlists' },
                { key: 'search', label: 'Search' },
              ]}
            />
            <DownloadsBar />
            {tab === 'phone' ? (
              <PhoneTab onBrowse={() => setTab('albums')} />
            ) : !server ? (
              <ConnectForm />
            ) : tab === 'albums' ? (
              <AlbumsTab onOpen={onOpen} />
            ) : tab === 'playlists' ? (
              <PlaylistsTab onOpen={onOpen} />
            ) : (
              <SearchTab onOpen={onOpen} />
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** Overall progress of running downloads, and failures to retry. */
function DownloadsBar() {
  const downloads = useLibrary((s) => s.downloads);
  const jobs = Object.values(downloads);
  if (!jobs.length) return null;
  const failed = jobs.filter((j) => j.status === 'error');
  const pending = jobs.filter((j) => j.status !== 'error');
  const fraction = pending.length ? pending.reduce((a, j) => a + j.fraction, 0) / pending.length : 0;
  return (
    <View style={styles.card}>
      {pending.length > 0 && (
        <>
          <View style={styles.cardRow}>
            <Text style={styles.cardText}>
              Downloading {pending.length} song{pending.length === 1 ? '' : 's'}…
            </Text>
            <Button label="Cancel all" variant="ghost" onPress={() => pending.forEach((j) => library.cancel(j.song.id))} />
          </View>
          <ProgressBar fraction={fraction} />
        </>
      )}
      {failed.length > 0 && (
        <View style={styles.cardRow}>
          <Text style={[styles.cardText, { color: colors.warnText }]} numberOfLines={2}>
            {failed.length} download{failed.length === 1 ? '' : 's'} failed: {failed[0].error}
          </Text>
          <Button label="Retry" variant="secondary" onPress={() => library.download(failed.map((j) => j.song))} />
          <IconButton label="Dismiss failed downloads" onPress={() => failed.forEach((j) => library.cancel(j.song.id))} size={36}>
            <Icon name="close" size={14} color={colors.textDim} />
          </IconButton>
        </View>
      )}
    </View>
  );
}

function ConnectForm() {
  const [address, setAddress] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await library.signIn(address, username, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Connect to Navidrome</Text>
      <Text style={styles.hint}>
        Sign in to a Navidrome server to download songs to this phone. Downloaded songs can be shared in a session with no
        internet, for example on a plane.
      </Text>
      <TextField
        label="Server address"
        value={address}
        onChangeText={setAddress}
        placeholder="music.example.com"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        textContentType="URL"
        returnKeyType="next"
      />
      <TextField
        label="Username"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="username"
        autoComplete="username"
        returnKeyType="next"
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        textContentType="password"
        autoComplete="password"
        returnKeyType="go"
        onSubmitEditing={() => !busy && connect()}
      />
      {error && <Banner text={error} tone="warn" />}
      <Button label="Connect" onPress={connect} busy={busy} disabled={!address.trim() || !username.trim()} />
    </View>
  );
}

function PhoneTab({ onBrowse }: { onBrowse: () => void }) {
  const songs = useLibrary((s) => s.songs);
  const server = useLibrary((s) => s.server);
  const [filter, setFilter] = useState('');
  const total = useMemo(() => songs.reduce((a, s) => a + s.size, 0), [songs]);
  const shown = useMemo(() => filterSongs(songs, filter), [songs, filter]);

  return (
    <View style={styles.section}>
      {songs.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No songs on this phone yet</Text>
          <Text style={styles.emptyText}>
            {server
              ? 'Browse albums or playlists and tap download. Do it before you lose internet.'
              : 'Connect to your Navidrome server, then download songs to take with you.'}
          </Text>
          <Button label={server ? 'Browse albums' : 'Connect a server'} onPress={onBrowse} style={{ marginTop: space.sm }} />
        </View>
      ) : (
        <>
          <Text style={styles.meta}>
            {songs.length} song{songs.length === 1 ? '' : 's'} · {formatBytes(total)} · ready to play offline
          </Text>
          {songs.length > 8 && (
            <TextField value={filter} onChangeText={setFilter} placeholder="Filter songs" autoCorrect={false} returnKeyType="search" />
          )}
          <View>
            {shown.map((s) => (
              <SongRow
                key={s.id}
                title={s.title}
                subtitle={[s.artist, s.album].filter(Boolean).join(' · ')}
                coverUri={library.coverUri(s)}
                right={
                  <IconButton label={`Remove ${s.title} from this phone`} onPress={() => confirmRemove(s.title, () => library.remove(s.id))} size={36}>
                    <Icon name="close" size={14} color={colors.textDim} />
                  </IconButton>
                }
              />
            ))}
          </View>
        </>
      )}
      <AccountCard />
    </View>
  );
}

function AccountCard() {
  const server = useLibrary((s) => s.server);
  if (!server) return null;
  return (
    <View style={[styles.card, styles.cardRow]}>
      <Text style={[styles.hint, styles.flex]} numberOfLines={2}>
        Connected to <Text style={styles.strong}>{server.url.replace(/^https?:\/\//, '')}</Text> as{' '}
        <Text style={styles.strong}>{server.username}</Text>
      </Text>
      <Button label="Sign out" variant="ghost" onPress={() => library.signOut()} />
    </View>
  );
}

function AlbumsTab({ onOpen }: Pick<Props, 'onOpen'>) {
  const [sort, setSort] = useState<AlbumListType>('newest');
  const [count, setCount] = useState(PAGE);
  const { data, error, loading, reload } = useRemote(`albums:${sort}:${count}`, () => library.client()!.albums(sort, count));
  return (
    <View style={styles.section}>
      <Tabs<AlbumListType>
        value={sort}
        onChange={(s) => {
          setSort(s);
          setCount(PAGE);
        }}
        tabs={[
          { key: 'newest', label: 'Newest' },
          { key: 'alphabeticalByName', label: 'A–Z' },
          { key: 'frequent', label: 'Most played' },
          { key: 'random', label: 'Random' },
        ]}
      />
      <RemoteState error={error} loading={loading && !data} onRetry={reload} />
      {data && data.length === 0 && <Text style={styles.meta}>No albums on this server.</Text>}
      <View>
        {data?.map((a) => (
          <AlbumRow key={a.id} album={a} onPress={() => onOpen('album', a.id, a.name)} />
        ))}
      </View>
      {data && data.length >= count && <Button label="Show more" variant="secondary" busy={loading} onPress={() => setCount((c) => c + PAGE)} />}
    </View>
  );
}

function PlaylistsTab({ onOpen }: Pick<Props, 'onOpen'>) {
  const { data, error, loading, reload } = useRemote('playlists', () => library.client()!.playlists());
  return (
    <View style={styles.section}>
      <RemoteState error={error} loading={loading && !data} onRetry={reload} />
      {data && data.length === 0 && <Text style={styles.meta}>No playlists yet. Make one in Navidrome and it shows up here.</Text>}
      <View>
        {data?.map((p) => (
          <PlaylistRow key={p.id} playlist={p} onPress={() => onOpen('playlist', p.id, p.name)} />
        ))}
      </View>
    </View>
  );
}

function SearchTab({ onOpen }: Pick<Props, 'onOpen'>) {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const { data, error, loading, reload } = useRemote(submitted ? `search:${submitted}` : null, () => library.client()!.search(submitted));
  const client = library.client();
  return (
    <View style={styles.section}>
      <TextField
        value={query}
        onChangeText={setQuery}
        placeholder="Songs, albums, artists"
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        onSubmitEditing={() => setSubmitted(query.trim())}
        accessibilityLabel="Search the server"
      />
      <RemoteState error={error} loading={loading} onRetry={reload} />
      {data && !loading && data.albums.length === 0 && data.songs.length === 0 && <Text style={styles.meta}>Nothing found for “{submitted}”.</Text>}
      {!!data?.albums.length && (
        <View>
          <Text style={styles.subTitle}>Albums</Text>
          {data.albums.map((a) => (
            <AlbumRow key={a.id} album={a} onPress={() => onOpen('album', a.id, a.name)} />
          ))}
        </View>
      )}
      {!!data?.songs.length && (
        <View>
          <Text style={styles.subTitle}>Songs</Text>
          {data.songs.map((s) => (
            <SongRow
              key={s.id}
              title={s.title}
              subtitle={[s.artist, s.album].filter(Boolean).join(' · ')}
              coverUri={s.coverArt && client ? client.coverUrl(s.coverArt, 120) : null}
              right={<DownloadButton song={s} />}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function AlbumRow({ album, onPress }: { album: Album; onPress: () => void }) {
  const client = library.client();
  const bits = [album.artist, album.year, album.songCount !== undefined ? `${album.songCount} songs` : undefined].filter(Boolean);
  return (
    <SongRow
      title={album.name}
      subtitle={bits.join(' · ')}
      coverUri={album.coverArt && client ? client.coverUrl(album.coverArt, 120) : null}
      onPress={onPress}
      right={<Icon name="chevron-right" size={16} color={colors.textMuted} />}
    />
  );
}

function PlaylistRow({ playlist, onPress }: { playlist: Playlist; onPress: () => void }) {
  const client = library.client();
  const bits = [playlist.songCount !== undefined ? `${playlist.songCount} songs` : undefined, playlist.owner && `by ${playlist.owner}`].filter(Boolean);
  return (
    <SongRow
      title={playlist.name}
      subtitle={bits.join(' · ')}
      coverUri={playlist.coverArt && client ? client.coverUrl(playlist.coverArt, 120) : null}
      onPress={onPress}
      right={<Icon name="chevron-right" size={16} color={colors.textMuted} />}
    />
  );
}

export function RemoteState({ error, loading, onRetry }: { error?: string; loading: boolean; onRetry: () => void }) {
  if (loading) return <ActivityIndicator color={colors.accent} style={{ marginVertical: space.lg }} />;
  if (!error) return null;
  return (
    <View style={styles.section}>
      <Banner text={error} tone="warn" />
      <Button label="Try again" variant="secondary" onPress={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { paddingHorizontal: space.lg, paddingTop: space.lg },
  inner: { width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', gap: space.lg },
  section: { gap: space.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, gap: space.md },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  cardText: { flex: 1, color: colors.textDim, fontSize: 13, fontWeight: '600' },
  hint: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  strong: { color: colors.text, fontWeight: '700' },
  meta: { color: colors.textMuted, fontSize: 13 },
  subTitle: { color: colors.text, fontSize: 16, fontWeight: '800', marginBottom: space.xs },
  empty: {
    alignItems: 'center',
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    gap: space.xs,
  },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  emptyText: { color: colors.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 18 },
});
