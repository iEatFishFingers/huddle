// The offline library: songs downloaded from a Navidrome server, kept on this phone so they can be
// shared in a session with no internet (e.g. on a plane). Also holds the server sign-in.
//
// Layout (in the app's documents folder, which the OS doesn't clear):
//   huddle-library/server.json   server address, username and token (never the password)
//   huddle-library/index.json    what's downloaded
//   huddle-library/songs/<id>.mp3
//   huddle-library/covers/<coverArt>.jpg
import { useSyncExternalStore } from 'react';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { devLog } from '../log';
import type { PickedFile } from '../transport/types';
import {
  DOWNLOAD_MAX_BITRATE,
  normalizeServerUrl,
  ServerConfig,
  Song,
  songFileName,
  SubsonicClient,
  SubsonicError,
} from './subsonic';

export type LibrarySong = {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  albumId?: string;
  coverArt?: string;
  durationMs: number;
  /** Name shown in the session, e.g. "Artist - Title.mp3". */
  name: string;
  /** File name inside songs/. */
  fileName: string;
  size: number;
  addedAt: number;
};

export type DownloadJob = {
  song: Song;
  status: 'queued' | 'downloading' | 'error';
  /** 0..1 (estimated when the server doesn't send a size, which is normal while transcoding). */
  fraction: number;
  error?: string;
};

type State = {
  server: ServerConfig | null;
  /** Newest first. */
  songs: LibrarySong[];
  /** Keyed by song id; finished downloads are removed. */
  downloads: Record<string, DownloadJob>;
};

const CONCURRENCY = 2;
const MIME = 'audio/mpeg';

const root = new Directory(Paths.document, 'huddle-library');
const songsDir = new Directory(root, 'songs');
const coversDir = new Directory(root, 'covers');
const serverFile = new File(root, 'server.json');
const indexFile = new File(root, 'index.json');

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const safeName = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '_');

function ensureDirs() {
  for (const d of [root, songsDir, coversDir]) {
    if (!d.exists) d.create({ intermediates: true, idempotent: true });
  }
}

function readJson<T>(f: File): T | null {
  try {
    return f.exists ? (JSON.parse(f.textSync()) as T) : null;
  } catch (e) {
    console.warn(`[library] couldn't read ${f.name}: ${errText(e)}`);
    return null;
  }
}

function writeJson(f: File, value: unknown) {
  try {
    ensureDirs();
    if (!f.exists) f.create();
    f.writeSync(JSON.stringify(value));
  } catch (e) {
    console.warn(`[library] couldn't save ${f.name}: ${errText(e)}`);
  }
}

function load(): State {
  const server = readJson<ServerConfig>(serverFile);
  const index = readJson<{ version: number; songs: LibrarySong[] }>(indexFile);
  // drop entries whose file has gone (e.g. restored from a backup without the songs)
  const songs = (index?.songs ?? []).filter((s) => {
    try {
      return new File(songsDir, s.fileName).exists;
    } catch {
      return false;
    }
  });
  return { server, songs, downloads: {} };
}

let state: State = load();
const listeners = new Set<() => void>();
const controllers = new Map<string, AbortController>();
let active = 0;
let client: SubsonicClient | null = state.server ? new SubsonicClient(state.server) : null;

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function setJob(id: string, job: DownloadJob | null) {
  const downloads = { ...state.downloads };
  if (job) downloads[id] = job;
  else delete downloads[id];
  set({ downloads });
}

function saveIndex() {
  writeJson(indexFile, { version: 1, songs: state.songs });
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function randomHex(bytes: number) {
  return Array.from(Crypto.getRandomBytes(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A download that "succeeded" but is tiny is usually an error message from the server, not audio. */
async function checkAudio(file: File) {
  const size = file.size ?? 0;
  if (size === 0) throw new Error('The server sent an empty file.');
  if (size > 4096) return;
  let text = '';
  try {
    text = (await file.text()).trim();
  } catch {
    return;
  }
  if (text.startsWith('{') || text.startsWith('<')) {
    let message = 'The server sent an error instead of the song.';
    try {
      message = JSON.parse(text)?.['subsonic-response']?.error?.message ?? message;
    } catch {}
    throw new Error(message);
  }
}

async function downloadCover(coverArt: string | undefined) {
  if (!coverArt || !client) return;
  const dest = new File(coversDir, `${safeName(coverArt)}.jpg`);
  if (dest.exists) return;
  try {
    await File.downloadFileAsync(client.coverUrl(coverArt), dest, { idempotent: true });
  } catch (e) {
    devLog(`[library] no cover for ${coverArt}: ${errText(e)}`);
    try {
      if (dest.exists) dest.delete();
    } catch {}
  }
}

async function run(song: Song) {
  if (!client) {
    setJob(song.id, { song, status: 'error', fraction: 0, error: 'Sign in to your music server first.' });
    return;
  }
  ensureDirs();
  const fileName = `${safeName(song.id)}.mp3`;
  const dest = new File(songsDir, fileName);
  const controller = new AbortController();
  controllers.set(song.id, controller);
  // Transcoded streams have no Content-Length, so estimate from duration × bitrate.
  const estimate = song.duration ? (song.duration * DOWNLOAD_MAX_BITRATE * 1000) / 8 : 0;
  let shown = 0;
  setJob(song.id, { song, status: 'downloading', fraction: 0 });
  try {
    await File.downloadFileAsync(client.streamUrl(song.id), dest, {
      idempotent: true,
      signal: controller.signal,
      onProgress: ({ bytesWritten, totalBytes }) => {
        const total = totalBytes > 0 ? totalBytes : estimate;
        if (!total) return;
        const fraction = Math.min(0.99, bytesWritten / total);
        // re-render at most every 2 %
        if (fraction - shown >= 0.02) {
          shown = fraction;
          setJob(song.id, { song, status: 'downloading', fraction });
        }
      },
    });
    await checkAudio(dest);
    await downloadCover(song.coverArt);
    const entry: LibrarySong = {
      id: song.id,
      title: song.title,
      artist: song.artist,
      album: song.album,
      albumId: song.albumId,
      coverArt: song.coverArt,
      durationMs: Math.round((song.duration ?? 0) * 1000),
      name: songFileName(song),
      fileName,
      size: dest.size ?? 0,
      addedAt: Date.now(),
    };
    set({ songs: [entry, ...state.songs.filter((s) => s.id !== song.id)] });
    saveIndex();
    setJob(song.id, null);
    devLog(`[library] downloaded "${entry.name}" (${Math.round(entry.size / 1024)} KB)`);
  } catch (e) {
    try {
      if (dest.exists) dest.delete();
    } catch {}
    if (controller.signal.aborted) setJob(song.id, null);
    else setJob(song.id, { song, status: 'error', fraction: 0, error: errText(e) });
  } finally {
    controllers.delete(song.id);
  }
}

function pump() {
  while (active < CONCURRENCY) {
    const next = Object.values(state.downloads).find((j) => j.status === 'queued');
    if (!next) return;
    active++;
    // mark it before awaiting so the loop doesn't pick it again
    setJob(next.song.id, { ...next, status: 'downloading' });
    run(next.song).finally(() => {
      active--;
      pump();
    });
  }
}

export const library = {
  get: () => state,
  subscribe,

  /** The signed-in server's API client, or null. */
  client: () => client,

  /** Checks the address and credentials with the server, then remembers them. Throws a readable error. */
  async signIn(address: string, username: string, password: string) {
    const url = normalizeServerUrl(address);
    if (!url) throw new SubsonicError("That doesn't look like a server address. Try something like music.example.com.");
    if (!username.trim()) throw new SubsonicError('Enter your username.');
    const salt = randomHex(8);
    const token = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.MD5, password + salt);
    const config: ServerConfig = { url, username: username.trim(), token, salt };
    const c = new SubsonicClient(config);
    await c.ping();
    client = c;
    writeJson(serverFile, config);
    set({ server: config });
  },

  /** Forgets the server. Downloaded songs stay on the phone. */
  signOut() {
    controllers.forEach((c) => c.abort());
    client = null;
    try {
      if (serverFile.exists) serverFile.delete();
    } catch {}
    set({ server: null, downloads: {} });
  },

  has: (id: string) => state.songs.some((s) => s.id === id),

  /** Queue songs for download (already downloaded or queued ones are skipped). */
  download(songs: Song[]) {
    const downloads = { ...state.downloads };
    let added = 0;
    for (const song of songs) {
      if (library.has(song.id)) continue;
      const existing = downloads[song.id];
      if (existing && existing.status !== 'error') continue;
      downloads[song.id] = { song, status: 'queued', fraction: 0 };
      added++;
    }
    if (!added) return;
    set({ downloads });
    pump();
  },

  /** Stop a queued or running download, or clear a failed one. */
  cancel(id: string) {
    const c = controllers.get(id);
    if (c) c.abort();
    else setJob(id, null);
  },

  /** Delete a downloaded song from the phone. */
  remove(id: string) {
    const song = state.songs.find((s) => s.id === id);
    if (!song) return;
    try {
      const f = new File(songsDir, song.fileName);
      if (f.exists) f.delete();
    } catch (e) {
      console.warn(`[library] couldn't delete ${song.fileName}: ${errText(e)}`);
    }
    const songs = state.songs.filter((s) => s.id !== id);
    if (song.coverArt && !songs.some((s) => s.coverArt === song.coverArt)) {
      try {
        const c = new File(coversDir, `${safeName(song.coverArt)}.jpg`);
        if (c.exists) c.delete();
      } catch {}
    }
    set({ songs });
    saveIndex();
  },

  /** Local cover image for a downloaded song, if there is one. */
  coverUri(song: Pick<LibrarySong, 'coverArt'>): string | null {
    if (!song.coverArt) return null;
    try {
      const f = new File(coversDir, `${safeName(song.coverArt)}.jpg`);
      return f.exists ? f.uri : null;
    } catch {
      return null;
    }
  },

  /** A downloaded song in the shape the session's addFiles() takes. */
  toPickedFile(song: LibrarySong): PickedFile {
    return {
      uri: new File(songsDir, song.fileName).uri,
      name: song.name,
      size: song.size,
      mimeType: MIME,
      durationMs: song.durationMs,
    };
  },
};

export function useLibrary<T>(select: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => select(state), () => select(state));
}

/** Songs whose title, artist or album contains `filter` (case-insensitive). */
export function filterSongs(songs: LibrarySong[], filter: string) {
  const q = filter.trim().toLowerCase();
  if (!q) return songs;
  return songs.filter((s) => [s.title, s.artist, s.album].some((v) => v?.toLowerCase().includes(q)));
}

/** "4.2 MB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
