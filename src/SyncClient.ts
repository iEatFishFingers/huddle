import { ClientMsg, PlaybackState, ServerMsg, Track, expectedPositionMs } from './protocol';
import { Transport } from './transport/types';

type Listener = () => void;

export class SyncClient {
  tracks: Track[] = [];
  state: PlaybackState = { trackId: null, playing: false, positionMs: 0, updatedAt: 0 };
  peers = 0;
  ready = 0;
  connected = false;
  /** hostClock - localClock, in ms */
  offset = 0;

  private listeners = new Set<Listener>();
  private syncTimer?: ReturnType<typeof setInterval>;
  private samples: { rtt: number; offset: number }[] = [];

  constructor(private transport: Transport) {
    transport.onMessage((m) => this.onMessage(m));
    transport.onStatus((connected) => {
      this.connected = connected;
      clearInterval(this.syncTimer);
      if (connected) {
        this.burstSync();
        this.syncTimer = setInterval(() => this.burstSync(), 10_000);
      }
      this.emit();
    });
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  hostNow() {
    return Date.now() + this.offset;
  }

  expectedPositionMs() {
    return expectedPositionMs(this.state, this.hostNow());
  }

  connect() {
    this.transport.connect();
  }

  disconnect() {
    clearInterval(this.syncTimer);
    this.transport.disconnect();
  }

  send(msg: ClientMsg) {
    this.transport.send(msg);
  }

  private burstSync() {
    this.samples = [];
    for (let i = 0; i < 6; i++) setTimeout(() => this.send({ type: 'ping', t0: Date.now() }), i * 80);
  }

  private onMessage(m: ServerMsg) {
    switch (m.type) {
      case 'pong': {
        const rtt = Date.now() - m.t0;
        this.samples.push({ rtt, offset: m.t1 - (m.t0 + rtt / 2) });
        // the lowest-RTT sample is the least distorted by network jitter
        this.offset = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).offset;
        break;
      }
      case 'welcome':
        this.tracks = m.tracks;
        this.state = m.state;
        this.peers = m.peers;
        this.ready = m.ready;
        break;
      case 'state':
        this.state = m.state;
        break;
      case 'tracks':
        this.tracks = m.tracks;
        break;
      case 'peers':
        this.peers = m.peers;
        break;
      case 'readiness':
        if (m.trackId === this.state.trackId) this.ready = m.ready;
        this.peers = m.total;
        break;
    }
    this.emit();
  }
}
