# Discovery

Back to [[Home]] · see also [[Architecture]], [[Decisions#Bluetooth for discovery only]]

`src/discovery/`. Nearby sessions are found over **Bluetooth LE** using [`expo-ble-kit`](https://github.com/sbaiahmed1/expo-ble-kit), which can both scan and advertise. Bluetooth only finds the host; everything else then goes over Wi-Fi to the [[Host Server]].

## Host side (`advertiser.ts`)
1. Opens a **GATT server** with the Huddle service (`17cfe356-3ff6-41ff-b6ec-c823a78aaeed`) and one readable characteristic, **session info** (`dea9833d-8719-481a-87a6-0d6c20fd75c3`).
2. The characteristic holds JSON: `{sessionName, hostName, host, port, members, maxMembers}`. It's ASCII-encoded with names clipped to 40 chars, so it stays under the 512-byte limit (`codec.ts`).
3. Advertises the service UUID.
   - iOS also advertises the name "Huddle".
   - Android omits the name, because it would use the phone's own Bluetooth name, which can overflow the advertisement.
4. `update()` refreshes the JSON when members change, and `stop()` tears everything down.

The JSON lives in a characteristic, not the advertisement, because **iOS advertisements can only carry a name and service UUIDs**.

## Joiner side (`scanner.ts`)
1. Scans filtered by the Huddle service UUID.
2. For each new host: connect, discover only the Huddle service, read session info, then disconnect. Connects run **one at a time**; phone Bluetooth stacks handle parallel connects badly.
3. Re-reads every 15 s to refresh member counts. A session drops off the list after 10 s without an advertisement.
4. The list is deduped by `host:port`, because Android hosts rotate their Bluetooth address.

Timeouts: connect 8 s, discover and read 5 s each, a whole cycle 15 s, disconnect 3 s. A failing host is retried with backoff starting at 2 s and doubling up to 30 s, and never blocks the others.

## Contract (`index.ts`)
```ts
useNearbySessions() → { sessions, scanning, error, rescan }
advertiseSession(info) → { update(info), stop(), error }   // error is live
```
Both degrade gracefully: on web, or in a build without the native module, they return a friendly `error` and never throw.

## Permissions
- **iOS:** one Bluetooth prompt (text set in `app.json`).
- **Android 12+:** "Nearby devices", which covers scan and connect for joiners, plus advertise for the host.
- **Android 11 and older:** Location permission, and Location must be on to scan.

## Gotchas
- An iPhone host **stops advertising in the background**: keep the app open.
- Bluetooth off is detected live, and scanning resumes when it's turned back on.
- Logs are prefixed `[ble]`. See [[Troubleshooting]].
