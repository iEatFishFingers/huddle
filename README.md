# Huddle

Listen to music together, in sync, on up to four phones in the same room. One phone hosts a session; friends nearby find it over Bluetooth and join with a tap. Everyone shares one queue, anyone can add songs, and anyone can play, pause, skip or seek.

Built with Expo (SDK 58) and React Native. Runs on iOS and Android, and works between the two.

## Features

- **Nearby sessions.** The host advertises its session over Bluetooth LE. Joiners see it in a list and tap to join, with no IP addresses to type. Joining by address is still there as a fallback.
- **Shared queue.** Up next, played history, tap to play now, reorder, remove, and auto-advance at the end of a track. The queue shows who added each song.
- **Anyone can add songs.** Songs you pick are uploaded to the host, which streams them to everyone.
- **Anyone controls playback.** Play, pause, next, previous, and a draggable seek bar. Pressing play while someone is still buffering waits until they're ready, for up to 8 seconds.
- **Tight sync.** Every phone syncs its clock with the host and corrects drift continuously. Small drift is corrected by a slight, pitch-corrected speed change; large gaps by a single seek.
- **Streaming.** Playback starts once a few seconds are buffered, instead of after downloading the whole file.

## Documentation

Detailed docs live in [`docs/`](docs/Home.md): one note per topic, linked together with `[[wikilinks]]`. Open the folder as an [Obsidian](https://obsidian.md) vault to browse it as a linked graph, or start at [docs/Home.md](docs/Home.md) on GitHub.

## How it works

```
Host phone                                  Joining phone
──────────                                  ─────────────
BLE advertise + "session info"  <-- scan, read --   finds the session (name, ip, port)
PeerServer :8787
  /ws      session protocol     <-- WebSocket -->   SyncClient (state + clock sync)
  /audio   streams tracks        -- HTTP ------>    useSession (player, drift correction)
  /upload  songs from joiners   <-- HTTP -------    "Add songs"
HostCore  queue · members · playback state (single source of truth)
```

- **Discovery** (`src/discovery/`). The host opens a GATT server with one readable characteristic holding the session's name, IP and port, and advertises its service UUID. Joiners scan for that UUID, read the characteristic, then connect over Wi-Fi. Bluetooth is only used to find the session; audio always goes over Wi-Fi or a phone hotspot.
- **Session protocol** (`src/protocol.ts`). JSON messages over WebSocket. The host is the single source of truth for the queue, members and playback state. Playback state is timestamped in the host's clock, so each phone can compute where it should be at any moment.
- **Host server** (`src/server/`). A small HTTP and WebSocket server built on `react-native-tcp-socket`. It runs inside the app on the host phone. The host's own UI talks to the core through a loopback transport.
- **Playback and sync** (`src/useSession.ts`, `src/SyncClient.ts`).
  - Clock offset comes from ping bursts, keeping the lowest-round-trip sample.
  - Each device learns its own start latency so it starts on time.
  - Drift is checked every second.

## Getting started

Requirements: Node 20+, an [Expo account](https://expo.dev), and physical phones. Bluetooth and the embedded server don't work in simulators or in Expo Go.

```bash
npm install
```

### 1. Install a development build on each phone (once)

Huddle uses native modules (Bluetooth, TCP sockets), so it needs a development build rather than Expo Go. Builds run in the cloud with EAS, so no Xcode or Android Studio is required.

```bash
npx eas-cli@latest login
npx eas-cli@latest build --profile development --platform android   # installable APK
npx eas-cli@latest build --profile development --platform ios       # needs a paid Apple Developer account
```

For iOS, register the iPhone first with `npx eas-cli@latest device:create`, and turn on **Developer Mode** on the phone (Settings → Privacy & Security). When a build finishes, open its page on the phone and install it.

You only need to rebuild when native code changes: a new native library, or a change to `app.json`, permissions or icons. Everything else reloads live.

### 2. Run the dev server

```bash
npx expo start --dev-client
```

Open Huddle on each phone and connect to the dev server. If the in-app QR scanner gives you trouble, tap **Enter URL manually** and enter `http://<your computer's LAN IP>:8081`. The phones and the computer must be on the same Wi-Fi network.

### 3. Try it

1. On one phone, enter your name, tap **Host a session**, and keep the app in the foreground. iOS stops Bluetooth advertising when the app is in the background.
2. On another phone, the session appears under **Nearby sessions**. Tap it to join. Allow Bluetooth ("Nearby devices" on Android) when asked.
3. Add songs from either phone and press play.

## Project layout

```
src/
  app/            Expo Router routes: index (find/host), session, _layout
  components/     Screens and UI pieces (SeekBar, QueueRow, SessionCard, Toast, …)
  ui/             Theme, icons, shared hooks
  session/        Active-session store (name, transport)
  discovery/      Bluetooth LE advertise/scan (expo-ble-kit)
  server/         Embedded HTTP + WebSocket server on the host
  transport/      Loopback (host) and WebSocket (joiner) transports
  HostCore.ts     Authoritative session state: members, queue, playback
  SyncClient.ts   Client-side state mirror + clock sync
  useSession.ts   Audio player, streaming, drift correction
  protocol.ts     Wire protocol shared by host and peers
  core/           HostCore tests
```

## Development

```bash
npm run check           # typecheck + lint + unit tests (run before committing)
npm run typecheck       # tsc --noEmit
npm run lint            # ESLint (eslint-config-expo)
npm test                # HostCore unit tests (queue, readiness, seeking)
npx expo-doctor         # dependency / config health check
```

Logs to watch in the dev server output:

- `[host]`: hosting, the network address, and server errors.
- `[ble]`: discovery, advertising, permissions and Bluetooth state.
- `[sync]`: drift corrections and the learned start lead.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Cannot find native module …` | The phone has an old build. Install the latest development build. |
| No nearby sessions | Turn Bluetooth on on both phones and allow the permission. Keep the host app open. Or use **Join with address instead**. |
| Host shows a mobile-data warning | The host must be on Wi-Fi, or be the hotspot others connect to. If it's the hotspot, joiners enter its address manually. |
| Joiner can't connect | Check that both phones are on the same Wi-Fi network. Guest networks often block devices from reaching each other. |
