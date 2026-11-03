# Queue

Back to [[Home]] · part of [[HostCore]] · UI in [[UI and Navigation]]

The queue is a list of **entries** (track ids) to play next. The library dedupes tracks, but the queue doesn't: the same song can be queued twice. Already-played tracks go into **history**, which keeps the last 200.

The current track is **not** in the queue. It's `state.trackId` (see [[Session Protocol]]).

## Actions
Anyone can send any of these, as `{ type: 'queue', action, … }`:

| Action | Effect |
| --- | --- |
| `add {trackId}` | Append to the end. If nothing is selected, it becomes the current track (paused) |
| `remove {index}` | Drop that entry |
| `move {from, to}` | Reorder. The UI uses up/down arrows |
| `next` | The current track goes to history and the first entry becomes current. With an empty queue: stop at 0 on the same track |
| `previous` | Past 3 s: restart the current track. Otherwise, the last history track comes back and the current one returns to the front of the queue. With no history: restart |
| `playIndex {index}` | Jump to that entry. The current track and every entry before it go to history |

Invalid indices are ignored.

## Auto-advance
When a phone's player finishes a track, it sends `ended`. The host advances like `next`. See [[HostCore#Rules it enforces]] for why one report is enough.

## Keeping playback going across tracks
If the session was playing (or about to play) when the track changes, it keeps playing. Every phone has to buffer the new track first, so the change goes through [[Readiness and Pending Play]]. If the "new" track is the one already loaded (the same song queued twice), readiness is kept and phones just seek to 0.
