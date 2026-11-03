# SyncClient

Back to [[Home]] · see also [[Session Protocol]], [[Transports]]

`src/SyncClient.ts`. Every phone has one, including the host, whose client talks to [[HostCore]] through the loopback [[Transports|transport]]. It mirrors the host's state and keeps the [[Clock Sync]] offset.

## Surface
```ts
new SyncClient(transport, name)
client.connected, client.you, client.sessionName
client.members, client.memberCount
client.tracks, client.queue, client.history
client.state, client.ready
client.trackById(id); client.currentTrack()
client.expectedPositionMs(); client.hostNow()
client.send(msg)
client.subscribe(fn) → unsubscribe       // any state change
client.onNotice(fn) → unsubscribe        // 'notice' toasts only
client.connect(); client.disconnect()
```

## Behaviour
- On every (re)connect it sends `hello {name}` **first**, then starts a ping burst. A reconnect looks like a new peer to the host (see [[Transports#Reconnecting]]).
- It applies `welcome`, `state`, `tracks`, `queue`, `members` and `readiness` messages as they arrive and notifies subscribers.
- `notice` messages go only to `onNotice` listeners, which drive the toasts in [[UI and Navigation]].

The audio side lives in `useSession` and is covered in [[Playback and Drift Correction]].
