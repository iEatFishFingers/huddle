# Architecture

Back to [[Home]].

Huddle has no cloud backend. One phone becomes the **host**: it runs a small server inside the app ([[Host Server]]) and holds the authoritative session state ([[HostCore]]). Other phones are **joiners** ([[Glossary#Peer|peers]]): they find the host over Bluetooth ([[Discovery]]), then talk to it over Wi-Fi.

```
Host phone                                  Joining phone
──────────                                  ─────────────
BLE advertise + "session info"  <-- scan, read --   Discovery
PeerServer :8787
  /ws      session protocol     <-- WebSocket -->   SyncClient
  /audio   streams tracks        -- HTTP ------>    useSession (player)
  /upload  songs from joiners   <-- HTTP -------    "Add songs"
HostCore  queue · members · playback state
```

## The pieces

| Piece | File(s) | Role |
| --- | --- | --- |
| [[Discovery]] | `src/discovery/` | Bluetooth LE: the host advertises, joiners scan and read the host's address |
| [[Host Server]] | `src/server/` | HTTP + WebSocket server on the host (`react-native-tcp-socket`) |
| [[HostCore]] | `src/HostCore.ts` | Members, [[Queue]], playback state; validates every action |
| [[Session Protocol]] | `src/protocol.ts` | The JSON messages both sides speak |
| [[Transports]] | `src/transport/` | How a [[SyncClient]] reaches HostCore: loopback or WebSocket |
| [[SyncClient]] | `src/SyncClient.ts` | Mirror of the host's state + [[Clock Sync]] |
| [[Playback and Drift Correction]] | `src/useSession.ts` | The audio player, streaming, staying in sync |
| [[Uploads]] | `PeerServer` + `WebSocketTransport` | Joiners adding songs |
| [[UI and Navigation]] | `src/app/`, `src/components/` | Expo Router screens |

## Key ideas
1. **One source of truth.** Every change (play, seek, queue edits) goes to [[HostCore]], which validates it and broadcasts the new state. Phones never change shared state locally.
2. **Time-stamped state.** Playback state says "at host time T we were at position P, playing". With [[Clock Sync]], each phone can work out where it should be right now, so the host never has to stream timing ticks.
3. **The host is a peer too.** The host's own UI uses a [[SyncClient]] over a loopback [[Transports|transport]], so it follows exactly the same code path as a joiner.
4. **Bluetooth finds, Wi-Fi carries.** Bluetooth LE is too slow for audio between iPhone and Android, so it's only used for [[Discovery]]. See [[Decisions#Bluetooth for discovery only]].
5. **Stream, don't download.** Joiners stream from the host's `/audio` endpoint with a buffer. See [[Decisions#Stream with a buffer]].

## A song's journey
1. Someone taps *Add songs*. On the host that's a local file; on a joiner it's an [[Uploads|upload]] to the host.
2. [[HostCore]] adds it to the library and the end of the [[Queue]]. If nothing was selected, it becomes the current track, paused.
3. Every phone loads the track (the host from its own file, joiners streamed over HTTP) and reports `ready`.
4. Someone presses play. Once everyone is ready ([[Readiness and Pending Play]]), the host stamps `playing: true` at its current time.
5. Each phone seeks to the expected position and plays. [[Playback and Drift Correction]] keeps it locked.
6. When the track ends, a phone reports `ended` and the host advances the [[Queue]].
