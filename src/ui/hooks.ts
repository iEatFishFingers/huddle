import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import { advertiseSession, AdvertisedSession } from '../discovery';
import { library, LibrarySong } from '../library/store';
import { MAX_PEERS } from '../protocol';
import type { LoopbackTransport } from '../transport/LoopbackTransport';
import type { PickedFile } from '../transport/types';

/** Re-renders every `ms` while `active` (for a live playback clock). */
export function useTicker(active: boolean, ms = 250) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(tick, ms);
    return () => clearInterval(id);
  }, [active, ms]);
}

/**
 * Host only: the join address of the on-phone server. Call this BEFORE useSession so the
 * onAddress listener is registered before the transport connects.
 */
export function useHostAddress(transport: LoopbackTransport | null) {
  const [address, setAddress] = useState<{ host: string; port: number } | null>(() => transport?.getAddress() ?? null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!transport) return;
    // onAddress replays the last result immediately if the server is already up
    transport.onAddress((ip, err) => {
      setError(err);
      const a = transport.getAddress();
      setAddress(a ?? (ip ? { host: ip, port: 0 } : null));
    });
  }, [transport]);
  return { address, error };
}

/** Host only: advertise the session over Bluetooth while mounted; keeps the member count current. */
export function useAdvertise(
  enabled: boolean,
  info: { sessionName: string; hostName: string; host: string | null; port: number; members: number },
) {
  const [error, setError] = useState<string | null>(null);
  const handle = useRef<Awaited<ReturnType<typeof advertiseSession>> | null>(null);
  const { sessionName, hostName, host, port, members } = info;
  const latest = useRef<AdvertisedSession | null>(null);

  // keep the latest info for the effects below (declared first, so it runs first)
  useEffect(() => {
    latest.current = host ? { sessionName, hostName, host, port, members, maxMembers: MAX_PEERS } : null;
  });

  // start once the address is known; restart only if the address itself changes
  useEffect(() => {
    if (!enabled || !host) return;
    let cancelled = false;
    advertiseSession(latest.current!)
      .then((h) => {
        if (cancelled) {
          h.stop().catch(() => {});
          return;
        }
        handle.current = h;
        setError(h.error);
        // members may have changed while we were starting
        if (latest.current) h.update(latest.current);
      })
      .catch((e) => !cancelled && setError(String(e?.message ?? e)));
    return () => {
      cancelled = true;
      handle.current?.stop().catch(() => {});
      handle.current = null;
    };
  }, [enabled, host, port]);

  useEffect(() => {
    if (latest.current) handle.current?.update(latest.current);
  }, [members, sessionName, hostName]);

  return { error };
}

type AddState = { count: number; fraction: number } | null;

/** Add songs to the session (from files or the offline library), with progress + error state. */
export function useAddSongs(
  // useSession's addFiles resolves false (with its own `error` set) instead of throwing
  addFiles: (files: PickedFile[], onProgress?: (fraction: number) => void) => Promise<unknown>,
) {
  const [progress, setProgress] = useState<AddState>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const add = useCallback(
    async (files: PickedFile[]) => {
      if (!files.length) return;
      setError(null);
      try {
        setProgress({ count: files.length, fraction: 0 });
        await addFiles(files, (fraction) => {
          if (mounted.current) setProgress({ count: files.length, fraction });
        });
      } catch (e) {
        if (mounted.current) setError(`Couldn't add songs: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (mounted.current) setProgress(null);
      }
    },
    [addFiles],
  );

  /** Pick audio files from the phone's files. */
  const pick = useCallback(async () => {
    setError(null);
    let files: PickedFile[];
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'audio/*', multiple: true, copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.length) return;
      files = res.assets.map((a) => ({
        uri: a.uri,
        name: a.name,
        size: a.size ?? 0,
        mimeType: a.mimeType ?? 'audio/mpeg',
        durationMs: 0,
      }));
    } catch (e) {
      if (mounted.current) setError(`Couldn't add songs: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    await add(files);
  }, [add]);

  /** Add songs downloaded to this phone's offline library (from Navidrome). */
  const addFromLibrary = useCallback((songs: LibrarySong[]) => add(songs.map(library.toPickedFile)), [add]);

  return { pick, addFromLibrary, progress, error, dismissError: () => setError(null) };
}
