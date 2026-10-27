import { ClientMsg, MAX_PEERS, PlaybackState, ServerMsg, Track } from './protocol';

type Outbox = {
  to: (peerId: string, msg: ServerMsg) => void;
  all: (msg: ServerMsg) => void;
};

/** Authoritative session state. Transports (loopback now, a native server later) feed it peers' messages. */
export class HostCore {
  tracks: Track[] = [];
  state: PlaybackState = { trackId: null, playing: false, positionMs: 0, updatedAt: Date.now() };
  private peers = new Map<string, string | null>(); // peerId -> trackId it has fully downloaded

  constructor(private out: Outbox) {}

  addTracks(tracks: Track[]) {
    this.tracks.push(...tracks);
    this.out.all({ type: 'tracks', tracks: this.tracks });
  }

  join(peerId: string): boolean {
    if (this.peers.size >= MAX_PEERS) return false;
    this.peers.set(peerId, null);
    this.out.to(peerId, {
      type: 'welcome',
      peers: this.peers.size,
      tracks: this.tracks,
      state: this.state,
      ready: this.readyCount(),
    });
    this.out.all({ type: 'peers', peers: this.peers.size });
    this.broadcastReadiness();
    return true;
  }

  leave(peerId: string) {
    this.peers.delete(peerId);
    this.out.all({ type: 'peers', peers: this.peers.size });
    this.broadcastReadiness();
  }

  handle(peerId: string, m: ClientMsg) {
    const now = Date.now();
    if (m.type === 'ping') return this.out.to(peerId, { type: 'pong', t0: m.t0, t1: now });
    if (m.type === 'ready') {
      if (m.trackId === this.state.trackId) this.peers.set(peerId, m.trackId);
      return this.broadcastReadiness();
    }
    const s = this.state;
    const pos = s.playing ? s.positionMs + (now - s.updatedAt) : s.positionMs;
    if (m.action === 'play') {
      if (!s.trackId || this.readyCount() < this.peers.size) return;
      this.state = { ...s, playing: true, positionMs: pos, updatedAt: now };
    }
    if (m.action === 'pause') this.state = { ...s, playing: false, positionMs: pos, updatedAt: now };
    if (m.action === 'seek') this.state = { ...s, positionMs: m.positionMs, updatedAt: now };
    if (m.action === 'select') {
      for (const id of this.peers.keys()) this.peers.set(id, null);
      this.state = { trackId: m.trackId, playing: false, positionMs: 0, updatedAt: now };
    }
    this.out.all({ type: 'state', state: this.state });
    if (m.action === 'select') this.broadcastReadiness();
  }

  private readyCount() {
    let n = 0;
    for (const t of this.peers.values()) if (t !== null && t === this.state.trackId) n++;
    return n;
  }

  private broadcastReadiness() {
    this.out.all({ type: 'readiness', trackId: this.state.trackId, ready: this.readyCount(), total: this.peers.size });
  }
}
