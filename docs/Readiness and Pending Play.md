# Readiness and Pending Play

Back to [[Home]] · part of [[HostCore]]

Phones stream audio ([[Decisions#Stream with a buffer]]), so a track isn't playable everywhere at the same moment. Starting before everyone has buffered would leave someone behind.

## Readiness
- When a phone has loaded the current track and filled its initial buffer, it sends `ready {trackId}`. See [[Playback and Drift Correction#Loading a track]].
- [[HostCore]] tracks which members are ready for the *current* track and broadcasts `readiness {ready, total}`.
- Changing track resets everyone's readiness, unless it's the same track id.
- After a reconnect, the client re-sends `ready` (see [[Transports#Reconnecting]]).

## Pending play
Pressing play when not everyone is ready doesn't fail. Instead:
1. The host sets `pendingPlay` and broadcasts the notice "Waiting for everyone to buffer…".
2. As soon as the last member reports ready, playback starts automatically.
3. **Fallback:** after 8 s (`PENDING_PLAY_TIMEOUT_MS`), it starts anyway with whoever is ready. A late phone catches up with a single seek when it's ready (see [[Playback and Drift Correction#Hard seek]]).
4. If the member being waited for leaves, the host re-checks and may start immediately.

Pause cancels a pending play. Skipping while playing also goes through pending play, so the next track starts as soon as everyone has it.

The session screen shows "Waiting for everyone (1/2 ready)" while this is happening. See [[UI and Navigation]].
