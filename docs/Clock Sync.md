# Clock Sync

Back to [[Home]] · part of [[SyncClient]] · used by [[Playback and Drift Correction]]

Playback state is time-stamped in the **host's** clock ([[Session Protocol]]). Each phone's clock differs, so every [[SyncClient]] estimates `offset = hostClock − localClock`.

## How it works
1. The client sends `ping {t0}` with its local time.
2. The host replies `pong {t0, t1}` with its own time `t1`.
3. On receipt: `rtt = now − t0` and `offset = t1 − (t0 + rtt/2)`. This assumes the trip there and back took equal time.
4. Pings go in **bursts of 6, 80 ms apart**, every **10 s**. The sample with the **lowest round-trip time** wins, because it's the one least distorted by Wi-Fi jitter.

`hostNow() = Date.now() + offset`, and `expectedPositionMs()` uses it.

On the host itself, the loopback transport makes the offset about 0.

## Why not just use phone time?
Phone clocks can be seconds apart. Even after NTP sync they differ by tens of milliseconds, which is audible as an echo between speakers.
