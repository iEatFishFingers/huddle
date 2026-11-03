# Project History

Back to [[Home]] · see also [[Decisions]], [[Open Items]]

What has been built so far, in order, with the reasons and the problems we hit along the way. Commit hashes refer to `main` on [GitHub](https://github.com/iEatFishFingers/huddle).

## Timeline at a glance
| Date | Milestone | Commits |
| --- | --- | --- |
| 2026-10-27 | Initial prototype: single screen, type an IP, download whole tracks | `c6ae4ce` |
| 2026-11-03 | Put on GitHub (public), music files removed from history | `2b9fb4d` |
| 2026-11-03 | First two-phone test; streaming and gentler sync | `cb05d75` |
| 2026-11-03 | Multi-agent build: nearby discovery, shared queue, uploads, new UI | `ba9ec3b` → `11abcbe` |
| 2026-11-03 | iPhone dropout fix | `ec76c25` |
| 2026-11-03 | Merged to `main`, README and docs | `21ba20a`, `bac3cfc`, `d6a7768` |
| 2026-11-03 | Bug fixes and codebase review | `4970651` → `c807541` |

---

## 1. Starting point
Commits: `c6ae4ce`

The prototype could already:
- host a session on one phone, using an embedded server on top of `react-native-tcp-socket`
- let others join by **typing the host's IP address**
- download each track completely before it could play
- keep phones in sync with [[Clock Sync]] and a drift check that **seeked** whenever a phone was more than 150 ms off

It was a single `App.tsx` screen, there was no git remote, and an audio file was committed in `music/`.

## 2. Repository set-up
Commits: `2b9fb4d`

- **Removed the audio file** and kept it out of the public history by amending the initial commit before the first push. `music/` is git-ignored.
- **Renamed** `master` to `main`.
- **Created the public GitHub repo** `iEatFishFingers/huddle` with a project description.
- Committed pending `app.json` changes: the iOS encryption flag and Android permissions.

## 3. First test on real phones
Commits: `cb05d75`

**Getting it running:**
- Expo Go can't load native modules such as TCP sockets, so each phone needs a **development build**, made with EAS in the cloud. Development is on Windows, so there's no local Xcode. See [[Development Setup]].
- The Android dev client's QR scanner hung on "downloading barcode UI". The workaround is **Enter URL manually**.
- `expo-doctor` found three problems:
  - `usesCleartextTraffic` was in a place Expo ignores. Without it, Android blocks the `ws://` and `http://` connection to the host. It moved into the `expo-build-properties` plugin.
  - `expo-asset` was missing; `expo-audio` needs it.
  - Six packages were behind their SDK 58 patch versions.

**What we heard:** the audio paused briefly every few seconds on both phones.
- **Cause:** every 2 s, a phone that was more than 150 ms off **seeked**. Seeking during playback causes a gap, and the seek's own delay left the phone behind again, so it seeked again.
- **Fix:** small drift is now corrected by briefly playing slightly faster or slower, with pitch correction. Only gaps over 1 s still seek. See [[Playback and Drift Correction]].

**Also fixed:**
- Adding the same song twice put duplicate entries in the list, which broke React keys. The host now ignores songs it already has.

**Product decisions:**
- **Stream, don't download**, because the full download was what you didn't want. See [[Decisions#Stream with a buffer]].
- **Bluetooth for finding sessions only.** iPhone↔Android is limited to BLE, which is too slow for four listeners. See [[Decisions#Bluetooth for discovery only]].

## 4. The multi-agent build
Commits: `ba9ec3b` → `11abcbe`

Four features were requested together: **find nearby sessions without typing an IP**, **anyone can add songs**, **a friendly shared queue**, and **anyone can seek**.

**Phase 0 (`ba9ec3b`), done first so the agents could work in parallel:**
- The wire contract in [[Session Protocol]]: tracks with `addedBy`, members, queue actions, `ended`, uploads, notices.
- Interfaces for [[Transports]] (`addFiles`) and [[Discovery]] (stubs).
- Installed Expo Router, safe-area-context, screens, linking and constants, plus `expo-ble-kit`.
- Configured `app.json`: router entry point, `huddle` scheme, Bluetooth plugin and permissions.

**Four agents, each in its own git worktree and owning separate files:**
| Agent | Built | Commit |
| --- | --- | --- |
| Core | [[HostCore]] queue, members, seek by anyone, auto-advance, [[Readiness and Pending Play]], 60 unit tests | `e7d4fa8` |
| Transports | [[Uploads]] from joiners, WebSocket auto-reconnect, Android hosting fixes | `ea7cee1` |
| Discovery | BLE advertise and GATT server on the host, scanning on joiners ([[Discovery]]), tested against the library's simulated Bluetooth | `75e9eb5` |
| UI | Expo Router home and session screens, seek bar, queue rows, toasts ([[UI and Navigation]]) | `4fb366a` |

**Android hosting failed before this.** The transports agent found three likely causes:
1. A JS reload left the native server holding port 8787, so the next listen failed. It now falls back to ports up to 8796. See [[Host Server#Startup]].
2. Audio was served as `application/octet-stream`, which iPhones won't play. It now sends the correct MIME type.
3. Android could report a mobile-data IP that other phones can't reach. That now shows a clear warning.

**Integration:**
- The branches merged cleanly. The only fix needed was one type mismatch (`ee2db34`).
- New EAS builds were made for both phones, because this round added native modules.
- **Snags:**
  - An old Metro process held port 8081, so the new server started on 8082 and the phones would have loaded stale code.
  - Windows ran low on memory and background tasks were stopped.
  - The Android phone kept showing `Cannot find native module 'ExpoLinking'` until the **new** APK was actually installed. See [[Troubleshooting]].

**Two-phone test results:**
- BLE discovery worked **in both directions**: iPhone→Android in about 2.5 s, Android→iPhone in about 1 s.
- **Android hosting worked.**
- Uploads, the queue and seeking worked.
- Remaining problem: **brief audio dropouts, on the iPhone only.**

## 5. The iPhone dropout fix
Commits: `ec76c25`

- **Cause:** on iOS, every `setPlaybackRate` call in `expo-audio` also resets the audio's `audioTimePitchAlgorithm`, and that causes an audible dropout. The drift correction changed the rate every second while catching up. Android doesn't have this behaviour.
- **Fix:**
  - A **fixed ±3 % rate step**, so the rate changes at most twice per correction.
  - The same pitch quality on every call.
  - A **learned start lead**: each phone measured about 150–330 ms of start latency, so it now starts that far ahead.
  - **Zero-tolerance seeks**, because iOS's default seek can land hundreds of ms off.

See [[Playback and Drift Correction#The iOS dropout lesson]].

## 6. Merged to `main`, README and docs
Commits: `21ba20a`, `bac3cfc`, `d6a7768`

- `feature/nearby-queue` was merged into `main` with a summary merge commit. Both branches are kept in sync on GitHub.
- The **README** covers features, how it works, setup with EAS builds, project layout and troubleshooting.
- **This docs vault:** notes per topic linked with wikilinks, readable in Obsidian or on GitHub.

## 7. Host always shown as "Guest"
Commits: `4970651`

- **Symptom:** after changing your name and hosting, the member list still said "Guest". It looked iPhone-only because that's where it was tried.
- **Cause:** the host's loopback transport reported "connected" *before* joining [[HostCore]]. [[SyncClient]] sends `hello {name}` the moment it connects, and HostCore ignores messages from non-members, so the name was dropped. Joiners were fine, because the server joins them before reading anything.
- **Fix:** join first, then report connected. See [[Transports]].

## 8. Codebase review
Commits: `3ad6e76`, `cc1fbc4`, `91544ab`, `c807541`

**Bugs:**
- **Joiners weren't told when the host ended the session.** They retried for 30 s, and the transport's `onError` ("session full", "lost connection") was never connected to the UI. Now the host sends WebSocket close `1001`, and joiners show the reason and return to the list. See [[Host Server#Ending and dead peers]].
- **Ghost members.** A phone that walked off Wi-Fi stayed a member and held up every track change by up to 8 s. Peers silent for 60 s are now dropped.
- **HostCore's pending-play timer** wasn't disposed when the session ended.
- **Uploaded songs** stayed in the host's cache forever. They're now deleted when the session ends, and leftovers from a crash are deleted when someone next hosts.

**Best practices:**
- **ESLint** (`eslint-config-expo`, including React's compiler-readiness rules), with all 24 findings fixed. The audio player now uses `useAudioPlayer`, which releases itself on unmount, and loading state is derived instead of reset inside effects. See [[Testing]].
- Clock-sync pongs no longer re-render the session screen six times per burst.
- Verbose `[ble]`/`[host]`/`[sync]` logs are **dev-only** (`src/log.ts`).
- **Removed:**
  - the stale `server/dev-host.mjs`, which used the old protocol, and its `ws` dependency
  - the microphone permission and duplicate storage permissions. These take effect at the next native build.
- **Scripts:** `npm run check`, `lint`, `typecheck` and `test`. The `build:dev:*` scripts now use `npx eas-cli@latest`.

---

## Lessons learned
- **Seeking is the enemy of smooth sync.** Correct small drift by adjusting the playback rate, and fix the start offset at the source.
- **Read the native code of the audio library.** The iOS dropout came from a hidden side effect in `setPlaybackRate`, and it only showed up on one platform.
- **Order matters on connect:** register first, then announce.
- **"Reload" is not "rebuild".** A `Cannot find native module` error means the phone needs the newer build installed. See [[Development Setup#When to rebuild]].
- **Bluetooth between iPhone and Android is BLE-only.** It's good for finding sessions, not for carrying audio.
- **Agree the contract before parallel work.** Phase 0 is why four agents' branches merged with a single type fix.

What's still open is tracked in [[Open Items]].
