export type Track = { id: string; title: string; url: string };

/** Authoritative playback state, timestamped in the host's clock. */
export type PlaybackState = {
  trackId: string | null;
  playing: boolean;
  positionMs: number; // position at `updatedAt`
  updatedAt: number; // host clock (ms)
};

export type ClientMsg =
  | { type: 'ping'; t0: number }
  | { type: 'control'; action: 'play' | 'pause' }
  | { type: 'control'; action: 'seek'; positionMs: number }
  | { type: 'control'; action: 'select'; trackId: string }
  | { type: 'ready'; trackId: string };

export type ServerMsg =
  | { type: 'pong'; t0: number; t1: number }
  | { type: 'welcome'; peers: number; tracks: Track[]; state: PlaybackState; ready: number }
  | { type: 'state'; state: PlaybackState }
  | { type: 'tracks'; tracks: Track[] }
  | { type: 'peers'; peers: number }
  | { type: 'readiness'; trackId: string | null; ready: number; total: number };

export const MAX_PEERS = 4;
export const HOST_PORT = 8787;

/** Where the player should be right now, given the host's clock reading. */
export function expectedPositionMs(s: PlaybackState, hostNow: number): number {
  return s.playing ? s.positionMs + (hostNow - s.updatedAt) : s.positionMs;
}
