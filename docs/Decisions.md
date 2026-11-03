# Decisions

Back to [[Home]] · see also [[Architecture]]

A log of the significant design choices and their reasons.

## Bluetooth for discovery only
**Decision:** Bluetooth LE finds the host. Audio and control go over Wi-Fi (or a phone hotspot).
**Why:**
- Between iPhone and Android, apps can only use **BLE**; iOS restricts Classic Bluetooth data to certified accessories.
- Real-world BLE throughput is about 20–100 KB/s, shared by everyone. One stream needs about 16–40 KB/s per listener, so four listeners wouldn't fit.
- Typing IP addresses was the real pain point, and discovery solves it.

**Consequences:** the host needs the peripheral role (advertise plus a GATT server). Most React Native BLE libraries are central-only (`react-native-ble-plx`, `react-native-ble-nitro`), so we chose `expo-ble-kit`. It was new and untested phone-to-phone at the time, but has since been verified iPhone↔Android in both directions. See [[Discovery]].

## Stream with a buffer
**Decision:** joiners stream from the host's `/audio` endpoint with about 10 s of forward buffer, instead of downloading whole files first.
**Why:** a faster start, and it's what users expect. The risk of mid-song stalls is handled by [[Readiness and Pending Play]] and hard seeks after a stall ([[Playback and Drift Correction]]).

## Single source of truth on the host
**Decision:** all shared state lives in [[HostCore]]. Phones send intents, and the host validates them and broadcasts the results.
**Why:** with no conflicting edits, everyone sees the same queue and timeline. The host's own UI uses the same path through a loopback [[Transports|transport]], so there's no special-cased host logic.

## Anyone can control everything
**Decision:** there are no host-only permissions for playback or the [[Queue]].
**Why:** it's a small group of friends in one room, and the product goal is shared control.

## Rate nudges instead of seeks
**Decision:** small drift is corrected with a **fixed ±3% pitch-corrected speed change**. Only gaps over 1 s seek. Each phone also learns its start latency.
**Why:**
- Seeking mid-song is an audible gap, and the seek's own latency leaves the phone behind again, which triggers another seek.
- Proportional rate changes every second caused **iPhone dropouts**, because iOS resets its pitch algorithm on every rate change.

See [[Playback and Drift Correction#The iOS dropout lesson]].

## Uploads go to the host
**Decision:** a joiner's song is uploaded to the host, which serves it to everyone.
**Why:** joiners don't need to run servers, there's one streaming path, and the host's library is the session's library. See [[Uploads]].

## Expo Router and development builds
**Decision:** use Expo Router for screens, and EAS development builds instead of Expo Go.
**Why:** the project's `AGENTS.md` requires Expo Router, and the native modules (BLE, TCP) rule out Expo Go. EAS cloud builds make it work from Windows. See [[Development Setup]].
