# Playback and Drift Correction

Back to [[Home]] · see also [[Clock Sync]], [[SyncClient]], [[Readiness and Pending Play]]

`src/useSession.ts` (`useSession(transport, name)`) owns the `expo-audio` player on each phone. It loads tracks, applies the host's state, and keeps the phone locked to the shared timeline.

## Loading a track
- Joiners **stream** from the host's `/audio/<id>` URL ([[Host Server]]). The host plays its own local file. See [[Decisions#Stream with a buffer]].
- The player is created with `preferredForwardBufferDuration: 10` seconds.
- It waits until the player `isLoaded && !isBuffering` (15 s timeout), sets the pitch algorithm once, then sends `ready`. See [[Readiness and Pending Play]].

## Applying state
Whenever `state` changes (play, pause, seek, or a restart):
- **Playing:** seek to `expectedPositionMs() + startLead` with **zero tolerance**, then `play()`.
- **Paused:** pause, then seek to `positionMs`.

Stale applications are cancelled when a newer one or a track change happens.

### Start lead
Players start late, by about 150–330 ms measured on phones (seek time plus audio output latency). So each phone starts **ahead** by a learned `startLeadMs` (initially 200 ms, capped at 800 ms). One second after each start it measures the remaining drift and adjusts: `lead −= drift × 0.6`. After a play or two, steady-state playback needs no correction.

## Continuous correction (every 1 s, while playing)
`drift = player.currentTime − expectedPositionMs()`. Positive means ahead of the host.

| Drift | Action |
| --- | --- |
| < 60 ms (or < 15 ms once correcting) | Normal speed |
| 60 ms – 1 s | Fixed **±3 %** speed, pitch-corrected, until within 15 ms |
| > 1 s | **Hard seek** (see below) |

The 60/15 ms thresholds are hysteresis: they stop the rate from flapping on and off.

### Hard seek
Used only for big gaps, for example after a stalled stream or a late joiner. It seeks to the expected position plus the start lead, then re-measures.

### Skipped while
- **Buffering:** a stall isn't drift. If the gap is large when the stream resumes, one hard seek fixes it.
- **After reporting `ended`:** waits for the host to advance instead of seeking back.

## End of track
The `playbackStatusUpdate` event's `didJustFinish` triggers `ended {trackId}` once per playthrough. See [[Queue#Auto-advance]].

## The iOS dropout lesson
On iOS, **every** `setPlaybackRate` call also resets the item's `audioTimePitchAlgorithm`, which causes an audible dropout. An earlier version adjusted the rate in proportion to the drift every second, and the iPhone cut out repeatedly while Android was fine. The fixes:
- a **fixed** rate step, so the rate changes at most twice per correction
- the same pitch quality on every call, set once at load
- the learned start lead, so corrections are rare

See [[Decisions#Rate nudges instead of seeks]].

## Logs
Messages prefixed `[sync]`: `nudging rate, drift …`, `seek, drift …`, and `start drift …, start lead now …`. See [[Troubleshooting]].
