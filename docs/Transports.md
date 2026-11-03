# Transports

Back to [[Home]] · see also [[SyncClient]], [[Host Server]]

`src/transport/`. A transport connects a [[SyncClient]] to [[HostCore]]. The interface is in `types.ts`:

```ts
connect(); disconnect(); send(msg)
onMessage(fn); onStatus(fn)
addFiles(files, addedBy, onProgress?)   // see Uploads
```

## LoopbackTransport (host)
- Creates [[HostCore]] in memory and joins itself as `self` with `isHost = true`.
- Starts the [[Host Server]] and reports the join address with `onAddress(fn)`. It also has `getAddress()` and `onServerError(fn)`.
- **Rewrites track URLs** for remote peers: the host plays local file URIs, while joiners get `http://<ip>:<port>/audio/<id>`.
- `addFiles` registers local files directly. There's no upload; see [[Uploads]].
- `memberCount()` is used when advertising over Bluetooth ([[Discovery]]).

## WebSocketTransport (joiner)
- Opens `ws://<host>:<port>/ws`. The host can be given as `ip` or `ip:port`.
- `addFiles` uploads each file to the host. See [[Uploads]].
- `onError(fn)` fires when it gives up: "The session is full." or "Lost connection to the host…".

### Reconnecting
If the socket drops unexpectedly, it retries with backoff (0.5 s, doubling to 5 s) for up to 30 s, calling `onStatus(false)` then `onStatus(true)`. It never reconnects after a deliberate `disconnect()`, or when the session is full (code `1013`).

A reconnect is a **new peer** to the host. That's why [[SyncClient]] re-sends `hello` and `useSession` re-sends `ready` (see [[Readiness and Pending Play]]).
