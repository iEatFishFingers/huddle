# Session Protocol

Back to [[Home]] · see also [[Architecture]], [[HostCore]], [[SyncClient]]

Defined in `src/protocol.ts`. Messages are JSON. They travel over a WebSocket at `/ws` on the [[Host Server]] for joiners, or in memory through the loopback [[Transports|transport]] for the host's own UI.

## Core types
- **`Track`**: `{ id, title, url, addedBy, durationMs }`.
  - The `id` is derived from the file name and size, so adding the same file twice is a no-op (see [[Uploads]]).
  - The `url` depends on who's reading it: joiners get the host's `/audio/<id>` URL, and the host gets its local file URI.
- **`PlaybackState`**: `{ trackId, playing, positionMs, updatedAt }`. `updatedAt` is in **host clock** time. This is the heart of sync: see [[Clock Sync]] and [[Playback and Drift Correction]].
- **`Member`**: `{ id, name, isHost }`.
- **`QueueAction`**: `add`, `remove`, `move`, `next`, `previous`, `playIndex`. See [[Queue]].

`expectedPositionMs(state, hostNow)` gives where playback should be right now: `positionMs + (hostNow − updatedAt)` while playing.

## Peer → host (`ClientMsg`)
| Message | Meaning |
| --- | --- |
| `ping {t0}` | [[Clock Sync]] probe |
| `hello {name}` | The first message after every (re)connect: who I am |
| `control play / pause` | Anyone can send it; play may wait, see [[Readiness and Pending Play]] |
| `control seek {positionMs}` | Anyone can seek |
| `queue {action…}` | A [[Queue]] edit |
| `ready {trackId}` | I've buffered this track and can start on cue |
| `ended {trackId}` | My player reached the end. The first valid report advances the [[Queue]] |

## Host → peers (`ServerMsg`)
| Message | Meaning |
| --- | --- |
| `pong {t0, t1}` | Reply to a ping with the host's time `t1` |
| `welcome {...}` | A full snapshot on join: `you`, `sessionName`, members, tracks, queue, history, state, ready count |
| `state` | New `PlaybackState` |
| `tracks` | The full library |
| `queue {queue, history}` | Up next + played |
| `members` | Who's in the session |
| `readiness {trackId, ready, total}` | How many have buffered the current track |
| `notice {text}` | A toast, e.g. "Sam added Song" (see [[UI and Navigation]]) |

## Limits and constants
- `MAX_PEERS = 4`: members including the host. A fifth peer gets WebSocket close code `1013`.
- `HOST_PORT = 8787`. It falls back to 8788–8796 if the port is taken (see [[Host Server]]).
- `UPLOAD_PATH = '/upload'`, `MAX_UPLOAD_BYTES = 50 MB`. See [[Uploads]].
