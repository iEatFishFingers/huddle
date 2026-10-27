import { useEffect, useReducer, useRef, useState } from 'react';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { SyncClient } from './SyncClient';
import { Transport } from './transport/types';
import { resolveLocalUri } from './trackFiles';

const DRIFT_THRESHOLD_MS = 150;
const LOAD_TIMEOUT_MS = 15_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Connects over a transport and keeps the local player locked to the host's playback state. */
export function useSession(transport: Transport) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [client] = useState(() => new SyncClient(transport));
  const [player] = useState(() => createAudioPlayer(null));
  const [loadedTrack, setLoadedTrack] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const applyId = useRef(0);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' }).catch(
      (e) => setError(String(e)),
    );
    const unsub = client.subscribe(rerender);
    client.connect();
    return () => {
      unsub();
      client.disconnect();
      player.remove();
    };
  }, [client, player]);

  const { trackId, playing, positionMs, updatedAt } = client.state;
  const trackUrl = client.tracks.find((t) => t.id === trackId)?.url;

  // download the selected track, load it, then tell the host we're ready
  useEffect(() => {
    const track = client.tracks.find((t) => t.id === trackId);
    setLoadedTrack(null);
    if (!track) return;
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        player.pause();
        player.replace(await resolveLocalUri(track));
        // isLoaded can still be true from the previous source right after replace()
        await sleep(200);
        for (let waited = 0; !cancelled && !player.isLoaded; waited += 100) {
          if (waited > LOAD_TIMEOUT_MS) throw new Error('audio failed to load');
          await sleep(100);
        }
        if (cancelled) return;
        setLoadedTrack(track.id);
        client.send({ type: 'ready', trackId: track.id });
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, player, trackId, trackUrl]);

  // apply host state once the local copy is loaded
  useEffect(() => {
    if (!trackId || loadedTrack !== trackId) return;
    const id = ++applyId.current;
    (async () => {
      if (playing) {
        await player.seekTo(client.expectedPositionMs() / 1000);
        if (id === applyId.current) player.play();
      } else {
        player.pause();
        await player.seekTo(positionMs / 1000);
      }
    })().catch((e) => setError(String(e)));
  }, [client, player, trackId, loadedTrack, playing, positionMs, updatedAt]);

  // continuous drift correction while playing
  useEffect(() => {
    if (!playing || loadedTrack !== trackId) return;
    const id = setInterval(() => {
      const target = client.expectedPositionMs();
      if (Math.abs(player.currentTime * 1000 - target) > DRIFT_THRESHOLD_MS) player.seekTo(target / 1000);
    }, 2000);
    return () => clearInterval(id);
  }, [playing, client, player, trackId, loadedTrack]);

  return { client, error, loading: !!trackId && loadedTrack !== trackId };
}
