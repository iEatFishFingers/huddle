import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { devLog } from './log';
import { SyncClient } from './SyncClient';
import { PickedFile, Transport } from './transport/types';

/** start nudging the rate once drift exceeds this... */
const NUDGE_START_MS = 60;
/** ...and return to normal speed once back within this (hysteresis avoids rate flapping) */
const NUDGE_STOP_MS = 15;
/** drift beyond this is corrected with a seek instead of a rate nudge */
const HARD_SEEK_MS = 1000;
/**
 * Fixed speed-up / slow-down while catching up (pitch-corrected, ~inaudible). A fixed step means
 * the rate changes at most twice per correction: on iOS every setPlaybackRate call also resets the
 * item's pitch algorithm, which causes an audible dropout, so frequent rate changes must be avoided.
 */
const RATE_NUDGE = 0.03;
/** same pitch quality on every call so iOS never switches algorithm mid-song */
const PITCH_QUALITY = 'high' as const;
/**
 * Players start late (seek + output latency, ~150-330 ms measured on phones). We start this far
 * ahead instead, and learn the real figure for this device from the drift right after each start,
 * so steady-state playback needs no rate changes at all. Shared across sessions on this device.
 */
let startLeadMs = 200;
const MAX_START_LEAD_MS = 800;
/** how much of each start's measured error to fold into the learned lead */
const LEAD_LEARN_RATE = 0.6;
/** seconds the player buffers ahead while streaming from the host */
const STREAM_BUFFER_S = 10;
const LOAD_TIMEOUT_MS = 15_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Connects over a transport and keeps the local player locked to the host's playback state. */
export function useSession(transport: Transport, name: string) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [client] = useState(() => new SyncClient(transport, name));
  // released automatically on unmount
  const player = useAudioPlayer(null, { preferredForwardBufferDuration: STREAM_BUFFER_S });
  /** Load key (track id + url) the player has loaded and buffered; "loading" = it isn't the current one. */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [playerDuration, setPlayerDuration] = useState<{ key: string; ms: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** bumped to invalidate in-flight state applications (e.g. when the source is replaced) */
  const applyId = useRef(0);
  /** what the player has loaded and buffered (mirrors loadedKey for event handlers) */
  const loadedRef = useRef<{ id: string; key: string } | null>(null);
  /** we already reported the end of the current playthrough */
  const endedSent = useRef(false);
  /** playback was just (re)started with the learned lead: next drift sample refines the lead */
  const measureStart = useRef(false);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' }).catch(
      (e) => setError(String(e)),
    );
    const unsub = client.subscribe(rerender);
    // duration + end-of-track detection
    const sub = player.addListener('playbackStatusUpdate', (status) => {
      const loaded = loadedRef.current;
      if (!loaded || loaded.id !== client.state.trackId) return; // event from a previous source
      if (status.isLoaded && status.duration > 0) {
        const ms = Math.round(status.duration * 1000);
        setPlayerDuration((prev) => (prev?.key === loaded.key && prev.ms === ms ? prev : { key: loaded.key, ms }));
      }
      if (status.didJustFinish && !endedSent.current) {
        endedSent.current = true;
        client.send({ type: 'ended', trackId: loaded.id });
      }
    });
    client.connect();
    return () => {
      unsub();
      sub.remove();
      client.disconnect();
    };
  }, [client, player]);

  const { trackId, playing, positionMs, updatedAt } = client.state;
  const trackUrl = client.trackById(trackId)?.url;
  const loadKey = trackId ? `${trackId}|${trackUrl ?? ''}` : null;
  const loaded = loadKey !== null && loadedKey === loadKey;

  // Stream the selected track (the host plays its own local file); once the player has
  // loaded and its initial buffer is filled, tell the host we're ready.
  useEffect(() => {
    const track = client.trackById(trackId);
    // drop any seek/play still in flight for the previous source
    applyId.current++;
    loadedRef.current = null;
    endedSent.current = false;
    if (!track || !loadKey) {
      player.pause();
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        player.pause();
        player.replace(track.url);
        // isLoaded can still be true from the previous source right after replace()
        await sleep(200);
        for (let waited = 0; !cancelled && (!player.isLoaded || player.isBuffering); waited += 100) {
          if (waited > LOAD_TIMEOUT_MS) throw new Error('audio failed to load');
          await sleep(100);
        }
        if (cancelled) return;
        // fix the pitch algorithm now, before playback, so later rate changes don't switch it
        // (pitch correction is on by default on both platforms)
        player.setPlaybackRate(1, PITCH_QUALITY);
        loadedRef.current = { id: track.id, key: loadKey };
        if (player.duration > 0) setPlayerDuration({ key: loadKey, ms: Math.round(player.duration * 1000) });
        setLoadedKey(loadKey);
        client.send({ type: 'ready', trackId: track.id });
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, player, trackId, loadKey]);

  // After a (re)connect the host may treat us as a new member with no readiness: re-announce.
  useEffect(() => {
    const loaded = loadedRef.current;
    if (client.connected && loaded && loaded.id === client.state.trackId) client.send({ type: 'ready', trackId: loaded.id });
  }, [client, client.connected, client.you]);

  // Apply host state once the local copy is loaded. Keyed on updatedAt, so every play/pause/seek
  // by anyone (and a restart of the same track) is applied immediately.
  useEffect(() => {
    if (!trackId || !loaded) return;
    const id = ++applyId.current;
    // a seek (or restart) means this playthrough hasn't ended yet
    endedSent.current = false;
    (async () => {
      if (playing) {
        // start ahead by this device's learned start latency so we land on time
        // zero tolerance: iOS otherwise seeks "near" the target, landing up to hundreds of ms off
        await player.seekTo((client.expectedPositionMs() + startLeadMs) / 1000, 0, 0);
        if (id === applyId.current) {
          player.play();
          measureStart.current = true;
        }
      } else {
        measureStart.current = false;
        player.pause();
        await player.seekTo(positionMs / 1000);
      }
    })().catch((e) => setError(String(e)));
  }, [client, player, trackId, loaded, playing, positionMs, updatedAt]);

  // Continuous drift correction while playing. Seeking mid-playback causes an audible
  // gap (and the seek's own latency leaves us behind again), so small drift is absorbed
  // by nudging the playback rate; only large jumps fall back to a seek.
  useEffect(() => {
    if (!playing || !trackId || !loaded) return;
    let rate = 1;
    const setRate = (r: number) => {
      if (r === rate) return;
      rate = r;
      player.setPlaybackRate(r, PITCH_QUALITY);
    };
    const id = setInterval(() => {
      // a stalled stream isn't drift; once it resumes, a large gap is fixed with one seek
      if (player.isBuffering) return;
      // we've played to the end and told the host; wait for it to move on rather than seek back
      if (endedSent.current) return;
      const drift = player.currentTime * 1000 - client.expectedPositionMs(); // + = ahead of host
      if (measureStart.current) {
        // first sample after a start: whatever error remains is our start-latency estimate's fault
        measureStart.current = false;
        if (Math.abs(drift) < HARD_SEEK_MS) {
          startLeadMs = Math.max(0, Math.min(MAX_START_LEAD_MS, startLeadMs - drift * LEAD_LEARN_RATE));
          devLog(`[sync] start drift ${Math.round(drift)}ms, start lead now ${Math.round(startLeadMs)}ms`);
        }
      }
      const nudging = rate !== 1;
      if (Math.abs(drift) > HARD_SEEK_MS) {
        setRate(1);
        player.seekTo((client.expectedPositionMs() + startLeadMs) / 1000, 0, 0);
        measureStart.current = true;
        devLog(`[sync] seek, drift ${Math.round(drift)}ms`);
      } else if (Math.abs(drift) > (nudging ? NUDGE_STOP_MS : NUDGE_START_MS)) {
        if (!nudging) devLog(`[sync] nudging rate, drift ${Math.round(drift)}ms`);
        setRate(drift < 0 ? 1 + RATE_NUDGE : 1 - RATE_NUDGE);
      } else {
        setRate(1);
      }
    }, 1000);
    return () => {
      clearInterval(id);
      if (rate !== 1) player.setPlaybackRate(1, PITCH_QUALITY);
    };
  }, [playing, client, player, trackId, loaded]);

  /** Add songs from this device. Resolves true on success; failures are surfaced in `error`. */
  const addFiles = useCallback(
    async (files: PickedFile[], onProgress?: (fraction: number) => void): Promise<boolean> => {
      if (files.length === 0) return true;
      try {
        await transport.addFiles(files, name, onProgress);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      }
    },
    [transport, name],
  );

  const durationMs = (playerDuration?.key === loadKey ? playerDuration.ms : 0) || client.currentTrack()?.durationMs || 0;

  return { client, error, loading: !!trackId && !loaded, durationMs, addFiles };
}
