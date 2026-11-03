# HostCore

Back to [[Home]] · see also [[Architecture]], [[Session Protocol]]

`src/HostCore.ts`. This is the authoritative session state. It only runs on the host, behind the loopback [[Transports|transport]] and the [[Host Server]]. It knows nothing about sockets: transports call it and give it an outbox with `to(peerId, msg)` and `all(msg)`.

## What it owns
- **Members**: join order, names (from `hello`, trimmed to 40 chars, default "Guest"), `isHost`, and what each member has buffered. See [[Readiness and Pending Play]].
- **Library**: every track anyone added, deduped by id.
- **[[Queue]]** and **history**.
- **`PlaybackState`**: see [[Session Protocol]].

## Public API
```ts
new HostCore(out, { sessionName, clock? })   // clock is injectable for tests
core.tracks
core.memberCount(); core.memberList()
core.join(peerId, isHost?) → boolean          // false when MAX_PEERS reached
core.leave(peerId)
core.handle(peerId, msg)                      // every ClientMsg
core.addTracks(tracks, { enqueue?, addedByPeer? }) → string[]   // ids actually added
core.dispose()                                // clears the pending-play timer
```

## Rules it enforces
- **Anyone can do anything.** There are no host-only controls: play, pause, seek and every [[Queue]] action are open to all members.
- **Messages from non-members are ignored**, except `ping`. Transports must call `join` first.
- **Seek** is clamped to `≥ 0` and to the track's duration when known.
- **Adding songs** appends them to the queue, and if nothing is selected, auto-selects the first one, *paused*. Adding never auto-plays. It also broadcasts a `notice` such as "Sam added Song".
- **`ended` is believed only once:** it must be for the current track, while playing, and past `min(1.5 s, duration/2)`. Duplicates from other phones are ignored.
- **Play waits for buffering:** see [[Readiness and Pending Play]].

## Tests
Its logic is covered by `src/core/HostCore.test.ts` (60 checks). See [[Testing]].
