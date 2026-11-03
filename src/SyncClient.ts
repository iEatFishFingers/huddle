import { ClientMsg, Member, PlaybackState, ServerMsg, Track, expectedPositionMs } from './protocol';
import { Transport } from './transport/types';

type Listener = () => void;
type NoticeListener = (text: string) => void;

const SYNC_BURST = 6;
const SYNC_BURST_SPACING_MS = 80;
const SYNC_INTERVAL_MS = 10_000;

/** Every peer's (including the host UI's) view of the session, plus host-clock sync. */
export class SyncClient {
  connected = false;
  /** hostClock - localClock, in ms */
  offset = 0;
  /** This peer's member id (from 'welcome'), null until welcomed. */
  you: string | null = null;
  sessionName = '';
  members: Member[] = [];
  tracks: Track[] = [];
  queue: string[] = [];
  history: string[] = [];
  state: PlaybackState = { trackId: null, playing: false, positionMs: 0, updatedAt: 0 };
  /** Members that have buffered the current track. */
  ready = 0;

  private listeners = new Set<Listener>();
  private noticeListeners = new Set<NoticeListener>();
  private syncTimer?: ReturnType<typeof setInterval>;
  private pingTimers: ReturnType<typeof setTimeout>[] = [];
  private samples: { rtt: number; offset: number }[] = [];

  constructor(
    private transport: Transport,
    readonly name: string,
  ) {
    transport.onMessage((m) => this.onMessage(m));
    transport.onStatus((connected) => {
      this.connected = connected;
      this.stopSync();
      if (connected) {
        // identify first, before pings or anything else
        this.send({ type: 'hello', name: this.name });
        this.burstSync();
        this.syncTimer = setInterval(() => this.burstSync(), SYNC_INTERVAL_MS);
      }
      this.emit();
    });
  }

  get memberCount() {
    return this.members.length;
  }

  trackById(id: string | null): Track | undefined {
    return id ? this.tracks.find((t) => t.id === id) : undefined;
  }

  currentTrack(): Track | undefined {
    return this.trackById(this.state.trackId);
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  onNotice(fn: NoticeListener) {
    this.noticeListeners.add(fn);
    return () => {
      this.noticeListeners.delete(fn);
    };
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
    this.stopSync();
    this.transport.disconnect();
  }

  send(msg: ClientMsg) {
    this.transport.send(msg);
  }

  private stopSync() {
    clearInterval(this.syncTimer);
    this.syncTimer = undefined;
    this.pingTimers.forEach(clearTimeout);
    this.pingTimers = [];
  }

  private burstSync() {
    this.samples = [];
    this.pingTimers.forEach(clearTimeout);
    this.pingTimers = [];
    for (let i = 0; i < SYNC_BURST; i++) {
      this.pingTimers.push(
        setTimeout(() => {
          if (this.connected) this.send({ type: 'ping', t0: Date.now() });
        }, i * SYNC_BURST_SPACING_MS),
      );
    }
  }

  private onMessage(m: ServerMsg) {
    switch (m.type) {
      case 'pong': {
        const rtt = Date.now() - m.t0;
        this.samples.push({ rtt, offset: m.t1 - (m.t0 + rtt / 2) });
        // the lowest-RTT sample is the least distorted by network jitter
        this.offset = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).offset;
        // nothing visible changed; don't re-render subscribers 6 times per sync burst
        // (expectedPositionMs() reads the new offset whenever it's next called)
        return;
      }
      case 'welcome':
        this.you = m.you;
        this.sessionName = m.sessionName;
        this.members = m.members;
        this.tracks = m.tracks;
        this.queue = m.queue;
        this.history = m.history;
        this.state = m.state;
        this.ready = m.ready;
        break;
      case 'state':
        // readiness for a new track starts from zero; the host's 'readiness' follows
        if (m.state.trackId !== this.state.trackId) this.ready = 0;
        this.state = m.state;
        break;
      case 'tracks':
        this.tracks = m.tracks;
        break;
      case 'queue':
        this.queue = m.queue;
        this.history = m.history;
        break;
      case 'members':
        this.members = m.members;
        break;
      case 'readiness':
        if (m.trackId === this.state.trackId) this.ready = m.ready;
        break;
      case 'notice':
        this.noticeListeners.forEach((l) => l(m.text));
        return; // no state change
    }
    this.emit();
  }
}
