import { useEffect, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';
import { useSession } from './src/useSession';
import { Transport } from './src/transport/types';
import { WebSocketTransport } from './src/transport/WebSocketTransport';
import { LoopbackTransport } from './src/transport/LoopbackTransport';

function Session({ transport, onLeave }: { transport: Transport; onLeave: () => void }) {
  const [address, setAddress] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  // registered before useSession so it is in place when the session connects
  useEffect(() => {
    if (transport instanceof LoopbackTransport) transport.onAddress((a, e) => (setAddress(a), setServerError(e)));
  }, [transport]);
  const { client, error, loading } = useSession(transport);
  const { state, tracks, peers, ready, connected, offset } = client;
  const current = tracks.find((t) => t.id === state.trackId);
  const allReady = peers > 0 && ready >= peers;
  const loopback = transport instanceof LoopbackTransport ? transport : null;

  const addSongs = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: 'audio/*', multiple: true, copyToCacheDirectory: true });
    if (res.canceled) return;
    loopback?.addTracks(
      res.assets.map((a) => ({ id: `${a.name}-${a.size ?? 0}`, title: a.name.replace(/\.[^.]+$/, ''), url: a.uri })),
    );
  };

  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.title}>{connected ? `Session · ${peers} listening` : 'Connecting…'}</Text>
      <Text style={styles.dim}>clock offset {Math.round(offset)} ms</Text>
      {address && <Text style={styles.address}>Friends join with: {address}</Text>}
      {serverError && <Text style={styles.error}>{serverError}</Text>}

      <View style={styles.now}>
        <Text style={styles.nowTitle}>{current?.title ?? 'Pick a track'}</Text>
        {current && (
          <Text style={styles.dim}>
            {loading ? 'Downloading…' : `Ready ${ready}/${peers}`}
            {!loading && !allReady && ' · waiting for everyone'}
          </Text>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
        <View style={styles.row}>
          <Btn label="−10s" onPress={() => client.send({ type: 'control', action: 'seek', positionMs: Math.max(0, client.expectedPositionMs() - 10000) })} />
          <Btn
            label={state.playing ? 'Pause' : 'Play'}
            disabled={!state.playing && (!current || !allReady)}
            onPress={() => client.send({ type: 'control', action: state.playing ? 'pause' : 'play' })}
          />
          <Btn label="+10s" onPress={() => client.send({ type: 'control', action: 'seek', positionMs: client.expectedPositionMs() + 10000 })} />
        </View>
      </View>

      {loopback && <Btn label="Add songs" onPress={addSongs} />}
      <ScrollView style={{ flex: 1 }}>
        {tracks.length === 0 && <Text style={styles.dim}>{loopback ? 'Add songs to get started.' : 'No tracks on the host yet.'}</Text>}
        {tracks.map((t) => (
          <Pressable key={t.id} style={styles.track} onPress={() => client.send({ type: 'control', action: 'select', trackId: t.id })}>
            <Text style={[styles.trackText, t.id === state.trackId && { color: '#1db954' }]}>{t.title}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Btn label="Leave" onPress={onLeave} />
    </SafeAreaView>
  );
}

function Btn({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable style={[styles.btn, disabled && { opacity: 0.4 }]} onPress={disabled ? undefined : onPress}>
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

export default function App() {
  const [host, setHost] = useState('');
  const [transport, setTransport] = useState<Transport | null>(null);
  const leave = () => setTransport(null);

  return (
    <>
      <StatusBar style="light" />
      {transport ? (
        <Session transport={transport} onLeave={leave} />
      ) : (
        <SafeAreaView style={[styles.screen, { justifyContent: 'center' }]}>
          <Text style={styles.title}>Huddle</Text>
          <Btn label="Host a session" onPress={() => setTransport(new LoopbackTransport())} />
          <Text style={styles.dim}>Or join one: enter the host's IP</Text>
          <TextInput
            style={styles.input}
            placeholder="192.168.1.20"
            placeholderTextColor="#666"
            value={host}
            onChangeText={setHost}
            autoCapitalize="none"
            keyboardType="numbers-and-punctuation"
          />
          <Btn label="Join session" onPress={() => host && setTransport(new WebSocketTransport(host))} />
        </SafeAreaView>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#121212', padding: 20, gap: 12 },
  title: { color: '#fff', fontSize: 28, fontWeight: '700' },
  address: { color: '#1db954', fontSize: 18, fontWeight: '700' },
  dim: { color: '#999' },
  error: { color: '#ff6b6b' },
  now: { backgroundColor: '#1e1e1e', borderRadius: 12, padding: 16, gap: 12 },
  nowTitle: { color: '#fff', fontSize: 20 },
  row: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  btn: { backgroundColor: '#1db954', paddingVertical: 10, paddingHorizontal: 18, borderRadius: 24, alignItems: 'center' },
  btnText: { color: '#000', fontWeight: '700' },
  track: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#333' },
  trackText: { color: '#fff', fontSize: 16 },
  input: { backgroundColor: '#1e1e1e', color: '#fff', padding: 12, borderRadius: 8, fontSize: 16 },
});
