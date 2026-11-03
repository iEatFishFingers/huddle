import {
  ClientMsg,
  MAX_PEERS,
  Member,
  PlaybackState,
  QueueAction,
  ServerMsg,
  Track,
  expectedPositionMs,
} from './protocol';

type Outbox = {
  to: (peerId: string, msg: ServerMsg) => void;
  all: (msg: ServerMsg) => void;
};

/** Injectable clock/timers so the core can be tested deterministically. */
export type HostClock = {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export type HostCoreOptions = {
  sessionName: string;
  /** Defaults to Date.now / global timers. */
  clock?: HostClock;
};

type MemberState = Member & {
  /** trackId this peer has buffered and can start on cue, else null */
  readyFor: string | null;
};

/** If someone hasn't buffered within this long of a pending play, start without them. */
export const PENDING_PLAY_TIMEOUT_MS = 8000;
/** 'previous' within this many ms of the start goes back a track; later it restarts the current one. */
export const PREVIOUS_RESTART_MS = 3000;
/** An 'ended' report is only believed once the host's own position for the track is past this. */
const MIN_ENDED_POSITION_MS = 1500;
const MAX_HISTORY = 200;
const MAX_NAME_LENGTH = 40;
const DEFAULT_NAME = 'Guest';

const systemClock: HostClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** Authoritative session state on the host. Transports (loopback + WebSocket server) feed it peers' messages. */
export class HostCore {
  readonly sessionName: string;
  private _tracks: Track[] = [];
  state: PlaybackState;
  queue: string[] = [];
  history: string[] = [];
  private members = new Map<string, MemberState>(); // insertion order = join order
  /** Playback should start as soon as every member has buffered the current track. */
  private pendingPlay = false;
  private pendingTimer: unknown = null;
  private clock: HostClock;

  constructor(
    private out: Outbox,
    opts: HostCoreOptions,
  ) {
    this.sessionName = opts.sessionName;
    this.clock = opts.clock ?? systemClock;
    this.state = { trackId: null, playing: false, positionMs: 0, updatedAt: this.clock.now() };
  }

  /** Read-only view of the library. */
  get tracks(): Track[] {
    return this._tracks;
  }

  memberCount(): number {
    return this.members.size;
  }

  memberList(): Member[] {
    return [...this.members.values()].map(({ id, name, isHost }) => ({ id, name, isHost }));
  }

  /** Stop timers (call when the session shuts down). */
  dispose() {
    this.cancelPending();
  }

  join(peerId: string, isHost = false): boolean {
    if (!this.members.has(peerId)) {
      if (this.members.size >= MAX_PEERS) return false;
      this.members.set(peerId, { id: peerId, name: DEFAULT_NAME, isHost, readyFor: null });
    }
    this.out.to(peerId, {
      type: 'welcome',
      you: peerId,
      sessionName: this.sessionName,
      members: this.memberList(),
      tracks: this._tracks,
      queue: this.queue,
      history: this.history,
      state: this.state,
      ready: this.readyCount(),
    });
    this.broadcastMembers();
    this.broadcastReadiness();
    return true;
  }

  leave(peerId: string) {
    if (!this.members.delete(peerId)) return;
    this.broadcastMembers();
    this.broadcastReadiness();
    // the one we were waiting for may have just left
    this.maybeStartPending();
  }

  handle(peerId: string, m: ClientMsg) {
    const member = this.members.get(peerId);
    if (m.type === 'ping') return this.out.to(peerId, { type: 'pong', t0: m.t0, t1: this.clock.now() });
    if (!member) return; // not joined (or rejected because full)
    switch (m.type) {
      case 'hello': {
        const name = String(m.name ?? '').trim().slice(0, MAX_NAME_LENGTH) || DEFAULT_NAME;
        if (name !== member.name) {
          member.name = name;
          this.broadcastMembers();
        }
        return;
      }
      case 'ready':
        if (m.trackId !== this.state.trackId) return; // stale
        member.readyFor = m.trackId;
        this.broadcastReadiness();
        this.maybeStartPending();
        return;
      case 'ended':
        return this.onEnded(m.trackId);
      case 'control':
        if (m.action === 'play') return this.play();
        if (m.action === 'pause') return this.pause();
        if (m.action === 'seek') return this.seek(m.positionMs);
        return;
      case 'queue':
        return this.onQueue(m);
    }
  }

  addTracks(tracks: Track[], opts: { enqueue?: boolean; addedByPeer?: string } = {}): string[] {
    const enqueue = opts.enqueue ?? true;
    const known = new Set(this._tracks.map((t) => t.id));
    const fresh = tracks.filter((t) => !known.has(t.id) && known.add(t.id));
    if (fresh.length === 0) return [];
    this._tracks = [...this._tracks, ...fresh];
    this.out.all({ type: 'tracks', tracks: this._tracks });
    if (enqueue) {
      this.queue = [...this.queue, ...fresh.map((t) => t.id)];
      this.autoSelect();
      this.broadcastQueue();
    }
    const who = (opts.addedByPeer && this.members.get(opts.addedByPeer)?.name) || fresh[0].addedBy || 'Someone';
    const what = fresh.length === 1 ? fresh[0].title : `${fresh.length} songs`;
    this.notice(`${who} added ${what}`);
    return fresh.map((t) => t.id);
  }

  // ---- playback ----

  private now() {
    return this.clock.now();
  }

  private position() {
    return expectedPositionMs(this.state, this.now());
  }

  private clamp(positionMs: number) {
    let p = Number.isFinite(positionMs) ? Math.max(0, positionMs) : 0;
    const dur = this.trackById(this.state.trackId)?.durationMs ?? 0;
    if (dur > 0) p = Math.min(p, dur);
    return p;
  }

  private setState(s: PlaybackState) {
    this.state = s;
    this.out.all({ type: 'state', state: s });
  }

  private play() {
    const s = this.state;
    if (!s.trackId || s.playing) return;
    if (this.allReady()) {
      this.cancelPending();
      this.setState({ ...s, playing: true, updatedAt: this.now() });
    } else if (!this.pendingPlay) {
      this.beginPending();
      this.notice('Waiting for everyone to buffer…');
    }
  }

  private pause() {
    this.cancelPending();
    const s = this.state;
    this.setState({ ...s, playing: false, positionMs: this.clamp(this.position()), updatedAt: this.now() });
  }

  private seek(positionMs: number) {
    if (!this.state.trackId) return;
    this.setState({ ...this.state, positionMs: this.clamp(positionMs), updatedAt: this.now() });
  }

  private onEnded(trackId: string) {
    const s = this.state;
    // first report for the track that is actually playing wins; duplicates arrive after we've
    // moved on (different track, stopped, or restarted near 0) and are ignored
    if (trackId !== s.trackId || !s.playing) return;
    const dur = this.trackById(trackId)?.durationMs ?? 0;
    const minPos = dur > 0 ? Math.min(MIN_ENDED_POSITION_MS, dur / 2) : MIN_ENDED_POSITION_MS;
    if (this.position() < minPos) return;
    this.advance();
  }

  /** Go to the next queued track, or stop at the end of the queue. */
  private advance() {
    const wasPlaying = this.state.playing || this.pendingPlay;
    if (this.queue.length === 0) {
      this.cancelPending();
      this.setState({ ...this.state, playing: false, positionMs: 0, updatedAt: this.now() });
      return;
    }
    const [next, ...rest] = this.queue;
    this.pushHistory(this.state.trackId);
    this.queue = rest;
    this.changeTrack(next, wasPlaying);
    this.broadcastQueue();
  }

  /**
   * Switch to `trackId` at 0. Everyone must buffer the new track before it starts, so playback
   * (if it should continue) goes through pendingPlay. Re-selecting the track already loaded keeps
   * readiness: players just seek back to 0.
   */
  private changeTrack(trackId: string, keepPlaying: boolean) {
    this.cancelPending();
    if (trackId !== this.state.trackId) {
      for (const m of this.members.values()) m.readyFor = null;
    }
    this.setState({ trackId, playing: false, positionMs: 0, updatedAt: this.now() });
    this.broadcastReadiness();
    if (keepPlaying) {
      if (this.allReady()) this.setState({ ...this.state, playing: true, updatedAt: this.now() });
      else this.beginPending();
    }
  }

  private beginPending() {
    this.cancelPending();
    this.pendingPlay = true;
    this.pendingTimer = this.clock.setTimeout(() => {
      this.pendingTimer = null;
      if (this.pendingPlay) this.startPending();
    }, PENDING_PLAY_TIMEOUT_MS);
  }

  private cancelPending() {
    this.pendingPlay = false;
    if (this.pendingTimer !== null) this.clock.clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
  }

  private maybeStartPending() {
    if (this.pendingPlay && this.allReady()) this.startPending();
  }

  private startPending() {
    this.cancelPending();
    const s = this.state;
    if (!s.trackId || s.playing) return;
    // positionMs is where it was paused (0 after a track change)
    this.setState({ ...s, playing: true, updatedAt: this.now() });
  }

  // ---- queue ----

  private onQueue(a: QueueAction) {
    const q = this.queue;
    const valid = (i: number, len = q.length) => Number.isInteger(i) && i >= 0 && i < len;
    switch (a.action) {
      case 'add': {
        if (!this.trackById(a.trackId)) return;
        this.queue = [...q, a.trackId];
        this.autoSelect();
        return this.broadcastQueue();
      }
      case 'remove': {
        if (!valid(a.index)) return;
        this.queue = q.filter((_, i) => i !== a.index);
        return this.broadcastQueue();
      }
      case 'move': {
        if (!valid(a.from) || !valid(a.to) || a.from === a.to) return;
        const next = [...q];
        const [entry] = next.splice(a.from, 1);
        next.splice(a.to, 0, entry);
        this.queue = next;
        return this.broadcastQueue();
      }
      case 'next':
        return this.advance();
      case 'playIndex': {
        if (!valid(a.index)) return;
        const wasPlaying = this.state.playing || this.pendingPlay;
        this.pushHistory(this.state.trackId, ...q.slice(0, a.index));
        const target = q[a.index];
        this.queue = q.slice(a.index + 1);
        this.changeTrack(target, wasPlaying);
        return this.broadcastQueue();
      }
      case 'previous': {
        if (this.position() > PREVIOUS_RESTART_MS || this.history.length === 0) return this.seek(0);
        const wasPlaying = this.state.playing || this.pendingPlay;
        const prev = this.history[this.history.length - 1];
        this.history = this.history.slice(0, -1);
        if (this.state.trackId) this.queue = [this.state.trackId, ...q];
        this.changeTrack(prev, wasPlaying);
        return this.broadcastQueue();
      }
    }
  }

  /** Nothing selected yet: take the first queued entry as the current track (paused at 0). */
  private autoSelect() {
    if (this.state.trackId !== null || this.queue.length === 0) return;
    const [first, ...rest] = this.queue;
    this.queue = rest;
    this.changeTrack(first, false);
  }

  private pushHistory(...ids: (string | null)[]) {
    const add = ids.filter((id): id is string => !!id);
    if (add.length === 0) return;
    this.history = [...this.history, ...add].slice(-MAX_HISTORY);
  }

  // ---- helpers ----

  private trackById(id: string | null) {
    return id ? this._tracks.find((t) => t.id === id) : undefined;
  }

  private readyCount() {
    let n = 0;
    for (const m of this.members.values()) if (m.readyFor !== null && m.readyFor === this.state.trackId) n++;
    return n;
  }

  private allReady() {
    return this.readyCount() >= this.members.size;
  }

  private notice(text: string) {
    this.out.all({ type: 'notice', text });
  }

  private broadcastMembers() {
    this.out.all({ type: 'members', members: this.memberList() });
  }

  private broadcastQueue() {
    this.out.all({ type: 'queue', queue: this.queue, history: this.history });
  }

  private broadcastReadiness() {
    this.out.all({ type: 'readiness', trackId: this.state.trackId, ready: this.readyCount(), total: this.members.size });
  }
}
