# Host Server

Back to [[Home]] · see also [[Architecture]], [[Transports]], [[Uploads]]

`src/server/`. This is a minimal HTTP + WebSocket server that runs **inside the host app**, built on `react-native-tcp-socket` (raw TCP). It's started by the loopback transport (see [[Transports]]).

| File | Role |
| --- | --- |
| `PeerServer.ts` | Accepts sockets and routes requests |
| `http.ts` | Pure helpers: request-head parsing, Range parsing, upload checks, MIME types. Node-testable |
| `ws.ts` | WebSocket handshake key and frame encode/parse (RFC 6455) |

## Endpoints
- **`GET /ws` (upgrade):** the [[Session Protocol]].
  - Each socket becomes a peer and is joined to [[HostCore]].
  - If the session is full, it gets close code `1013`.
- **`GET /audio/<trackId>`:** streams a track with **Range** support: open-ended, suffix (`bytes=-N`), and `416` for an out-of-range request.
  - It sends the correct `Content-Type` from the file name. iPhones (AVPlayer) won't play `application/octet-stream`.
- **`POST /upload`:** a joiner adding a song. See [[Uploads]].

## Startup
1. Gets the phone's IP with `expo-network` and checks the network type.
   - **Mobile data:** shows a warning. Nearby phones can't reach that address. This happens when the phone shares a hotspot, or its Wi-Fi has no internet.
   - **`0.0.0.0`, loopback or IPv6:** an error, with no address.
2. Listens on `0.0.0.0:8787`. **If that port is taken, it tries 8788–8796.** On Android, a JS reload can leave the old native server holding the port.
3. Listen times out after 5 s. A start that's still in flight is cancelled if the user leaves (a generation counter).

## Ending and dead peers
- **Ending the session** (`stop()`): every peer gets WebSocket close **1001** ("going away") before the server shuts down. Joiners then show "The host ended the session." and go back to the list, instead of retrying (see [[Transports#Reconnecting]]). Uploaded songs are deleted (see [[Uploads]]).
- **Idle peers:** a peer that sends nothing for **60 s** is dropped. Clients ping every 10 s ([[Clock Sync]]), so this only catches dead connections. A phone that walks out of Wi-Fi range never sends a TCP reset, and without this it would stay a "ghost" member that holds up every track change ([[Readiness and Pending Play]]).

## Errors
Every failure (listen, socket, audio, upload, network) is reported in two places:
- `onServerError` to the UI
- `console.warn('[host] …')` in the dev-server logs

See [[Troubleshooting]].
