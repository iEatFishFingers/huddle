// Client for the Subsonic API, which Navidrome (and other self-hosted music servers) speak.
// Spec: https://www.subsonic.org/pages/api.jsp and https://opensubsonic.netlify.app
//
// Pure TypeScript with no React Native imports, so it can be unit-tested with plain node.
// Hashing the password needs MD5, which lives in store.ts (expo-crypto).

/** Where the server is and who we are. `token` = md5(password + salt); the password itself is never kept. */
export type ServerConfig = {
  /** Base URL, e.g. "https://music.example.com" (no trailing slash, no "/rest"). */
  url: string;
  username: string;
  token: string;
  salt: string;
};

export type Song = {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  albumId?: string;
  /** Seconds. */
  duration?: number;
  coverArt?: string;
  track?: number;
  suffix?: string;
  bitRate?: number;
};

export type Album = {
  id: string;
  name: string;
  artist?: string;
  coverArt?: string;
  songCount?: number;
  /** Seconds. */
  duration?: number;
  year?: number;
};

export type Playlist = {
  id: string;
  name: string;
  songCount?: number;
  duration?: number;
  coverArt?: string;
  owner?: string;
};

export type AlbumListType = 'newest' | 'recent' | 'frequent' | 'random' | 'alphabeticalByName' | 'starred';

export class SubsonicError extends Error {
  /** Subsonic error code (40 = wrong username or password, 70 = not found), or HTTP status for transport errors. */
  code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.name = 'SubsonicError';
    this.code = code;
  }
}

export const API_VERSION = '1.16.1';
export const CLIENT_NAME = 'huddle';
/** Songs are fetched as MP3 so they play on both iOS and Android, at a size that's quick to share. */
export const DOWNLOAD_FORMAT = 'mp3';
export const DOWNLOAD_MAX_BITRATE = 256;
const TIMEOUT_MS = 15_000;

/**
 * Turn whatever the user typed into a base URL:
 * "music.example.com" → "https://music.example.com", "192.168.1.5:4533" → "http://192.168.1.5:4533".
 * Strips a trailing "/", "/rest" or Navidrome's web-app path ("/app/#/album/...").
 * Returns null if it isn't a usable address.
 */
export function normalizeServerUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) {
    const hostPart = s.split(/[/:]/)[0];
    // Plain IPs, localhost and *.local names are almost always home servers without HTTPS.
    const local = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostPart) || hostPart === 'localhost' || hostPart.endsWith('.local');
    s = `${local ? 'http' : 'https'}://${s}`;
  }
  const m = /^(https?):\/\/([^/?#\s]+)([^?#\s]*)([?#]\S*)?$/i.exec(s);
  if (!m) return null;
  const [, scheme, host] = m;
  let path = m[3];
  path = path.replace(/\/app(\/.*)?$/i, '').replace(/\/rest(\/.*)?$/i, '').replace(/\/+$/, '');
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host) && !/^\[[0-9a-f:]+\](:\d{1,5})?$/i.test(host)) return null;
  return `${scheme.toLowerCase()}://${host}${path}`;
}

/** "a=1&b=x%20y" (React Native's URLSearchParams is incomplete, so build it by hand). */
export function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

/** Unwrap `{"subsonic-response": {...}}`, throwing a readable error for `status: "failed"`. */
export function unwrapResponse(json: unknown): Record<string, unknown> {
  const r = (json as { 'subsonic-response'?: Record<string, unknown> } | null)?.['subsonic-response'];
  if (!r || typeof r !== 'object') throw new SubsonicError("That address answered, but it isn't a Navidrome (Subsonic) server.");
  if (r.status !== 'ok') {
    const err = (r.error ?? {}) as { code?: number; message?: string };
    throw new SubsonicError(friendlyError(err.code, err.message), err.code);
  }
  return r;
}

function friendlyError(code: number | undefined, message: string | undefined): string {
  switch (code) {
    case 40:
      return 'Wrong username or password.';
    case 41:
      return "This server doesn't allow token sign-in. Ask the server owner to check its settings.";
    case 50:
      return "Your account isn't allowed to do that on this server.";
    case 70:
      return "That item isn't on the server any more.";
    default:
      return message || `The server returned an error${code !== undefined ? ` (code ${code})` : ''}.`;
  }
}

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Safe, readable file name for a song: "Artist - Title.mp3". Used as the session title too. */
export function songFileName(song: Pick<Song, 'title' | 'artist'>, ext = DOWNLOAD_FORMAT): string {
  const base = [song.artist, song.title].filter(Boolean).join(' - ') || 'Untitled';
  const clean = base
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return `${clean || 'Untitled'}.${ext}`;
}

type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class SubsonicClient {
  constructor(
    readonly config: ServerConfig,
    private fetchFn: FetchFn = (url, init) => fetch(url, init),
  ) {}

  /** Query string with the auth parameters every call needs. */
  private auth(extra: Record<string, string | number | boolean | undefined> = {}) {
    return buildQuery({
      u: this.config.username,
      t: this.config.token,
      s: this.config.salt,
      v: API_VERSION,
      c: CLIENT_NAME,
      f: 'json',
      ...extra,
    });
  }

  url(endpoint: string, extra: Record<string, string | number | boolean | undefined> = {}) {
    return `${this.config.url}/rest/${endpoint}?${this.auth(extra)}`;
  }

  private async call(endpoint: string, extra: Record<string, string | number | boolean | undefined> = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await this.fetchFn(this.url(endpoint, extra), { signal: controller.signal });
    } catch (e) {
      const aborted = controller.signal.aborted;
      throw new SubsonicError(
        aborted
          ? "The server didn't answer in time. Check the address, and that you're online."
          : `Couldn't reach the server. Check the address, and that you're online. (${e instanceof Error ? e.message : String(e)})`,
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new SubsonicError(
        res.status === 404
          ? "Found a website at that address, but no music server. Check the address."
          : `The server returned HTTP ${res.status}.`,
        res.status,
      );
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new SubsonicError("That address answered, but it isn't a Navidrome (Subsonic) server.");
    }
    return unwrapResponse(json);
  }

  /** Checks the address and the credentials. */
  async ping(): Promise<void> {
    await this.call('ping');
  }

  async albums(type: AlbumListType = 'newest', size = 60, offset = 0): Promise<Album[]> {
    const r = await this.call('getAlbumList2', { type, size, offset });
    return asArray((r.albumList2 as { album?: Album | Album[] } | undefined)?.album);
  }

  async album(id: string): Promise<{ album: Album; songs: Song[] }> {
    const r = await this.call('getAlbum', { id });
    const a = (r.album ?? {}) as Album & { song?: Song | Song[] };
    const { song, ...album } = a;
    return { album, songs: asArray(song) };
  }

  async playlists(): Promise<Playlist[]> {
    const r = await this.call('getPlaylists');
    return asArray((r.playlists as { playlist?: Playlist | Playlist[] } | undefined)?.playlist);
  }

  async playlist(id: string): Promise<{ playlist: Playlist; songs: Song[] }> {
    const r = await this.call('getPlaylist', { id });
    const p = (r.playlist ?? {}) as Playlist & { entry?: Song | Song[] };
    const { entry, ...playlist } = p;
    return { playlist, songs: asArray(entry) };
  }

  async search(query: string): Promise<{ albums: Album[]; songs: Song[] }> {
    const r = await this.call('search3', { query, artistCount: 0, albumCount: 20, songCount: 50 });
    const res = (r.searchResult3 ?? {}) as { album?: Album | Album[]; song?: Song | Song[] };
    return { albums: asArray(res.album), songs: asArray(res.song) };
  }

  /** Download URL: transcoded to MP3 (Navidrome sends the original if it's already a small enough MP3). */
  streamUrl(songId: string) {
    return this.url('stream', { id: songId, format: DOWNLOAD_FORMAT, maxBitRate: DOWNLOAD_MAX_BITRATE });
  }

  coverUrl(coverArtId: string, size = 300) {
    return this.url('getCoverArt', { id: coverArtId, size });
  }
}
