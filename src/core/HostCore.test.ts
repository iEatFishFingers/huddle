// Pure-logic checks for HostCore's queue / readiness / auto-advance behaviour.
// No test framework: transpile and run with node, e.g.
//   npx tsc src/core/HostCore.test.ts --ignoreConfig --rootDir src --outDir <scratch> --module commonjs --target es2022 --skipLibCheck --strict
//   node <scratch>/core/HostCore.test.js
import { HostCore, HostClock, PENDING_PLAY_TIMEOUT_MS } from '../HostCore';
import { ServerMsg, Track } from '../protocol';

let failures = 0;
let passes = 0;
function check(cond: unknown, label: string) {
  if (cond) passes++;
  else {
    failures++;
    console.log(`  FAIL: ${label}`);
  }
}
function eq<T>(actual: T, expected: T, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(a === e, `${label} (expected ${e}, got ${a})`);
}

class FakeClock implements HostClock {
  t = 1_000_000;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private nextId = 1;
  now = () => this.t;
  setTimeout = (fn: () => void, ms: number) => {
    const id = this.nextId++;
    this.timers.push({ at: this.t + ms, fn, id });
    return id;
  };
  clearTimeout = (h: unknown) => {
    this.timers = this.timers.filter((x) => x.id !== h);
  };
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      const due = this.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((x) => x !== due);
      this.t = due.at;
      due.fn();
    }
    this.t = end;
  }
}

function setup() {
  const clock = new FakeClock();
  const sent: { to: string | '*'; msg: ServerMsg }[] = [];
  const core = new HostCore(
    { to: (to, msg) => sent.push({ to, msg }), all: (msg) => sent.push({ to: '*', msg }) },
    { sessionName: 'Test', clock },
  );
  const last = <K extends ServerMsg['type']>(type: K) =>
    [...sent].reverse().find((s) => s.msg.type === type)?.msg as Extract<ServerMsg, { type: K }> | undefined;
  return { clock, sent, core, last };
}

const track = (id: string, durationMs = 0): Track => ({ id, title: `Song ${id}`, url: `file:///${id}`, addedBy: 'Sam', durationMs });

function test(name: string, fn: () => void) {
  const before = failures;
  fn();
  console.log(`${failures === before ? 'ok  ' : 'FAIL'} ${name}`);
}

test('join / hello / members / full', () => {
  const { core, sent, last } = setup();
  check(core.join('h', true), 'host joins');
  const welcome = sent.find((s) => s.to === 'h' && s.msg.type === 'welcome')?.msg;
  check(welcome && welcome.type === 'welcome' && welcome.you === 'h' && welcome.sessionName === 'Test', 'welcome to host');
  eq(last('members')?.members, [{ id: 'h', name: 'Guest', isHost: true }], 'default name Guest');
  core.handle('h', { type: 'hello', name: '  Sam ' });
  eq(last('members')?.members[0].name, 'Sam', 'hello sets name');
  check(core.join('a') && core.join('b') && core.join('c'), 'three more join');
  check(!core.join('d'), 'fifth is rejected (MAX_PEERS)');
  eq(core.memberCount(), 4, 'memberCount');
  core.leave('c');
  eq(core.memberCount(), 3, 'leave');
});

test('addTracks: dedupe, enqueue, auto-select (no autoplay), notice', () => {
  const { core, last } = setup();
  core.join('h', true);
  core.handle('h', { type: 'hello', name: 'Sam' });
  eq(core.addTracks([track('A')], { addedByPeer: 'h' }), ['A'], 'adds A');
  eq(core.state.trackId, 'A', 'A auto-selected');
  eq(core.state.playing, false, 'not auto-played');
  eq(core.queue, [], 'current track is not in the queue');
  eq(last('notice')?.text, 'Sam added Song A', 'single notice');
  eq(core.addTracks([track('A'), track('B'), track('C'), track('D')], { addedByPeer: 'h' }), ['B', 'C', 'D'], 'dedupes A');
  eq(last('notice')?.text, 'Sam added 3 songs', 'multi notice');
  eq(core.queue, ['B', 'C', 'D'], 'queue');
  eq(core.tracks.length, 4, 'library');
  eq(core.addTracks([track('A')]), [], 'all-duplicate add returns []');
  eq(core.addTracks([track('E')], { enqueue: false }), ['E'], 'library-only add');
  eq(core.queue, ['B', 'C', 'D'], 'enqueue:false leaves queue');
  core.handle('h', { type: 'queue', action: 'add', trackId: 'B' });
  eq(core.queue, ['B', 'C', 'D', 'B'], 'queue allows duplicate entries');
  core.handle('h', { type: 'queue', action: 'add', trackId: 'nope' });
  eq(core.queue.length, 4, 'unknown track ignored');
});

test('queue actions: move / remove / next / playIndex / previous', () => {
  const { core, clock } = setup();
  core.join('h', true);
  core.addTracks(['A', 'B', 'C', 'D', 'E'].map((id) => track(id)));
  eq([core.state.trackId, core.queue], ['A', ['B', 'C', 'D', 'E']], 'initial');
  core.handle('h', { type: 'queue', action: 'move', from: 3, to: 0 });
  eq(core.queue, ['E', 'B', 'C', 'D'], 'move 3->0');
  core.handle('h', { type: 'queue', action: 'move', from: 0, to: 9 });
  eq(core.queue, ['E', 'B', 'C', 'D'], 'invalid move ignored');
  core.handle('h', { type: 'queue', action: 'remove', index: 1 });
  eq(core.queue, ['E', 'C', 'D'], 'remove 1');
  core.handle('h', { type: 'queue', action: 'remove', index: -1 });
  core.handle('h', { type: 'queue', action: 'remove', index: 1.5 });
  eq(core.queue, ['E', 'C', 'D'], 'invalid remove ignored');
  core.handle('h', { type: 'queue', action: 'next' });
  eq([core.state.trackId, core.queue, core.history], ['E', ['C', 'D'], ['A']], 'next');
  core.handle('h', { type: 'queue', action: 'playIndex', index: 1 });
  eq([core.state.trackId, core.queue, core.history], ['D', [], ['A', 'E', 'C']], 'playIndex skips into history');
  core.handle('h', { type: 'queue', action: 'playIndex', index: 0 });
  eq(core.state.trackId, 'D', 'invalid playIndex ignored');
  // previous within 3 s goes back
  core.handle('h', { type: 'queue', action: 'previous' });
  eq([core.state.trackId, core.queue, core.history], ['C', ['D'], ['A', 'E']], 'previous goes back');
  // previous after 3 s restarts
  core.handle('h', { type: 'ready', trackId: 'C' });
  core.handle('h', { type: 'control', action: 'play' });
  eq(core.state.playing, true, 'playing');
  clock.advance(5000);
  core.handle('h', { type: 'queue', action: 'previous' });
  eq([core.state.trackId, core.state.positionMs, core.state.playing], ['C', 0, true], 'previous after 3 s restarts');
  // skipping while playing keeps playing once ready
  core.handle('h', { type: 'queue', action: 'next' });
  eq([core.state.trackId, core.state.playing], ['D', false], 'next while playing waits for buffer');
  core.handle('h', { type: 'ready', trackId: 'D' });
  eq([core.state.playing, core.state.positionMs, core.state.updatedAt], [true, 0, clock.t], 'then auto-starts at 0');
  // next at end of queue stops
  core.handle('h', { type: 'queue', action: 'next' });
  eq([core.state.trackId, core.state.playing, core.state.positionMs], ['D', false, 0], 'next on empty queue stops');
});

test('ended: advances once, ignores duplicates / stale, stops at end', () => {
  const { core, clock } = setup();
  core.join('h', true);
  core.join('a');
  core.addTracks([track('A', 60_000), track('B', 60_000)]);
  core.handle('h', { type: 'ready', trackId: 'A' });
  core.handle('a', { type: 'ready', trackId: 'A' });
  core.handle('h', { type: 'control', action: 'play' });
  eq(core.state.playing, true, 'A playing');
  clock.advance(60_000);
  core.handle('a', { type: 'ended', trackId: 'A' });
  eq([core.state.trackId, core.history, core.queue], ['B', ['A'], []], 'first ended advances');
  core.handle('h', { type: 'ended', trackId: 'A' });
  eq(core.state.trackId, 'B', 'duplicate (stale) ended ignored');
  eq(core.state.playing, false, 'B waits for buffering');
  core.handle('h', { type: 'ready', trackId: 'B' });
  eq(core.state.playing, false, 'still waiting for a');
  core.handle('a', { type: 'ready', trackId: 'A' });
  eq(core.state.playing, false, 'stale ready ignored');
  core.handle('a', { type: 'ready', trackId: 'B' });
  eq(core.state.playing, true, 'starts when last peer ready');
  core.handle('h', { type: 'ended', trackId: 'B' });
  eq(core.state.trackId, 'B', 'ended right after start (pos ~0) ignored');
  clock.advance(60_000);
  core.handle('h', { type: 'ended', trackId: 'B' });
  eq([core.state.trackId, core.state.playing, core.state.positionMs], ['B', false, 0], 'end of queue: stop, keep track');
  core.handle('a', { type: 'ended', trackId: 'B' });
  eq([core.state.trackId, core.state.playing, core.history], ['B', false, ['A']], 'duplicate after stop ignored');
});

test('ended: same track queued twice restarts it without re-buffering', () => {
  const { core, clock } = setup();
  core.join('h', true);
  core.addTracks([track('A', 30_000)]);
  core.handle('h', { type: 'queue', action: 'add', trackId: 'A' });
  core.handle('h', { type: 'ready', trackId: 'A' });
  core.handle('h', { type: 'control', action: 'play' });
  clock.advance(30_000);
  core.handle('h', { type: 'ended', trackId: 'A' });
  eq([core.state.trackId, core.state.playing, core.state.positionMs, core.queue], ['A', true, 0, []], 'A again, playing');
  clock.advance(100);
  core.handle('h', { type: 'ended', trackId: 'A' });
  eq(core.history, ['A'], 'late duplicate ignored');
});

test('play while buffering -> pendingPlay, notice, start on last ready', () => {
  const { core, last, clock } = setup();
  core.join('h', true);
  core.join('a');
  core.addTracks([track('A')]);
  core.handle('h', { type: 'ready', trackId: 'A' });
  core.handle('a', { type: 'control', action: 'play' });
  eq(core.state.playing, false, 'not started yet');
  eq(last('notice')?.text, 'Waiting for everyone to buffer…', 'notice');
  clock.advance(1000);
  core.handle('a', { type: 'ready', trackId: 'A' });
  eq([core.state.playing, core.state.updatedAt], [true, clock.t], 'started when a ready');
  // pause cancels a pending play
  core.handle('h', { type: 'control', action: 'pause' });
  eq(core.state.playing, false, 'paused');
});

test('pendingPlay 8 s fallback and leave', () => {
  const { core, clock } = setup();
  core.join('h', true);
  core.join('slow');
  core.addTracks([track('A')]);
  core.handle('h', { type: 'ready', trackId: 'A' });
  core.handle('h', { type: 'control', action: 'play' });
  clock.advance(PENDING_PLAY_TIMEOUT_MS - 1);
  eq(core.state.playing, false, 'still waiting at 7.999 s');
  clock.advance(1);
  eq([core.state.playing, core.state.positionMs, core.state.updatedAt], [true, 0, clock.t], 'started at 8 s');
  // pause then play again; slow peer leaves -> starts immediately
  core.handle('h', { type: 'control', action: 'pause' });
  core.handle('h', { type: 'control', action: 'play' });
  eq(core.state.playing, false, 'waiting for slow again');
  core.leave('slow');
  eq(core.state.playing, true, 'starts when the laggard leaves');
  // paused pending play doesn't fire later
  core.handle('h', { type: 'control', action: 'pause' });
  core.join('x');
  core.handle('h', { type: 'control', action: 'play' });
  core.handle('h', { type: 'control', action: 'pause' });
  clock.advance(PENDING_PLAY_TIMEOUT_MS * 2);
  eq(core.state.playing, false, 'cancelled timer does not fire');
});

test('seek clamps', () => {
  const { core } = setup();
  core.join('h', true);
  core.addTracks([track('A', 10_000), track('B')]);
  core.handle('h', { type: 'control', action: 'seek', positionMs: -50 });
  eq(core.state.positionMs, 0, 'clamped to 0');
  core.handle('h', { type: 'control', action: 'seek', positionMs: 99_999 });
  eq(core.state.positionMs, 10_000, 'clamped to duration');
  core.handle('h', { type: 'queue', action: 'next' });
  core.handle('h', { type: 'control', action: 'seek', positionMs: 99_999 });
  eq(core.state.positionMs, 99_999, 'unknown duration: no upper clamp');
});

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) throw new Error(`${failures} check(s) failed`);
