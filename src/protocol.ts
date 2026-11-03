// Wire protocol between the host (HostCore) and every peer, including the host's own UI
// (which talks to HostCore through LoopbackTransport). All messages are JSON over WebSocket.

export type Track = {
  id: string;
  title: string;
  /** Where peers stream it from. Remote peers get the host's /audio/<id> URL; the host gets its local file URI. */
  url: string;
  /** Display name of whoever added it. */
  addedBy: string;
  /** Length in ms, if the adder knew it (0 = unknown). */
  durationMs: number;
};

/** Authoritative playback state, timestamped in the host's clock. */
export type PlaybackState = {
  /** The track now playing (or paused); not part of `queue`. */
  trackId: string | null;
  playing: boolean;
  positionMs: number; // position at `updatedAt`
  updatedAt: number; // host clock (ms)
};

export type QueueAction =
  /** Append a track (already in the library) to the end of the queue. */
  | { action: 'add'; trackId: string }
  /** Remove the queue entry at `index`. */
  | { action: 'remove'; index: number }
  /** Move the queue entry at `from` so it ends up at index `to`. */
  | { action: 'move'; from: number; to: number }
  /** Skip to the next queued track. */
  | { action: 'next' }
  /** Restart the current track, or go back to the previous one if within the first 3 s. */
  | { action: 'previous' }
  /** Start the queue entry at `index` now (entries before it move to history). */
  | { action: 'playIndex'; index: number };

export type ClientMsg =
  | { type: 'ping'; t0: number }
  /** First message from every peer: who they are. */
  | { type: 'hello'; name: string }
  | { type: 'control'; action: 'play' | 'pause' }
  /** Anyone may seek. */
  | { type: 'control'; action: 'seek'; positionMs: number }
  | ({ type: 'queue' } & QueueAction)
  /** Peer has buffered `trackId` and can start it on cue. */
  | { type: 'ready'; trackId: string }
  /** Peer's player reached the end of `trackId`. The host advances once (first report wins). */
  | { type: 'ended'; trackId: string };

export type Member = { id: string; name: string; isHost: boolean };

export type ServerMsg =
  | { type: 'pong'; t0: number; t1: number }
  | {
      type: 'welcome';
      /** This peer's own member id. */
      you: string;
      sessionName: string;
      members: Member[];
      tracks: Track[];
      queue: string[];
      history: string[];
      state: PlaybackState;
      ready: number;
    }
  | { type: 'state'; state: PlaybackState }
  /** Full library (every track anyone added). */
  | { type: 'tracks'; tracks: Track[] }
  /** Upcoming track ids, in play order. `history` is what already played, oldest first. */
  | { type: 'queue'; queue: string[]; history: string[] }
  | { type: 'members'; members: Member[] }
  | { type: 'readiness'; trackId: string | null; ready: number; total: number }
  /** Transient notice to show as a toast, e.g. "Sam added Song". */
  | { type: 'notice'; text: string };

export const MAX_PEERS = 4;
export const HOST_PORT = 8787;

/** WebSocket close codes the host sends. Peers must not reconnect after either. */
export const CLOSE_SESSION_ENDED = 1001; // "going away": the host ended the session
export const CLOSE_SESSION_FULL = 1013; // "try again later": MAX_PEERS reached

/**
 * Uploads: a joining peer adds a song by sending
 *   POST /upload?name=<urlencoded file name>&addedBy=<urlencoded name>
 *   Content-Type: <audio mime>   Content-Length: <bytes>   X-Huddle-Duration-Ms: <ms or 0>
 * with the raw file bytes as the body. The host stores it, adds it to the library AND the
 * end of the queue, and replies 200 with JSON `{ "trackId": string }` (413 if too large).
 */
export const UPLOAD_PATH = '/upload';
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Where the player should be right now, given the host's clock reading. */
export function expectedPositionMs(s: PlaybackState, hostNow: number): number {
  return s.playing ? s.positionMs + (hostNow - s.updatedAt) : s.positionMs;
}
