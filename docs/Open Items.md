# Open Items

Back to [[Home]] · see also [[Project History]], [[Decisions]]

Things that are known but not done yet, roughly in priority order.

## Needs testing on the phones
- [ ] **The Navidrome library** ([[Navidrome Library]]):
  - Sign in with a real Navidrome account (a domain over HTTPS, and a LAN IP over HTTP).
  - Download an album, check progress, cancel one song, retry a failure.
  - Turn on airplane mode, reopen the app, and check the songs are still listed and play in a session.
  - Add library songs from a joiner: the upload, and the "Artist - Title" names in the queue.
- [ ] **The codebase-review fixes** ([[Project History#8. Codebase review]]):
  - Tap **End** on the host and check that the joiner shows "The host ended the session." and returns to the list.
  - Play a few songs to confirm the switch to `useAudioPlayer` behaves the same as before.
- [ ] **The iPhone dropout fix** ([[Playback and Drift Correction#The iOS dropout lesson]]):
  - Confirm there are no more cut-outs.
  - Watch `[sync] start drift …, start lead now …` settle after a few plays.
- [ ] **The host name fix:** a custom name shows in the member list on both phones.

## Next native build
These are already committed, but only take effect in a new EAS build. See [[Development Setup#When to rebuild]].
- [ ] No microphone permission, and `RECORD_AUDIO` removed.
- [ ] Optionally, replace the deprecated core `SafeAreaView` usage, if any warnings remain.

## Before an App Store / Play Store release
- [ ] **ATS:** iOS currently allows all plain-HTTP connections (`NSAllowsArbitraryLoads`). Test whether `NSAllowsLocalNetworking` alone covers `http://<LAN IP>`; if it does, drop the broad exception.
- [ ] **LICENSE** still names the Expo template's copyright holder (650 Industries). Replace it with the project owner's details or another licence.
- [ ] **Background:** an iPhone host stops Bluetooth advertising in the background ([[Discovery#Gotchas]]). Decide whether that's acceptable, or whether hosts should be told to keep the app open.
- [ ] **Release builds:** EAS `production` profile, app icons and store listing.

## Code health
- [ ] Commit the HTTP-helper tests and the Bluetooth tests (they currently live outside the repo) and wire them into `npm test`. See [[Testing]].
- [ ] Enable the React Compiler (`experiments.reactCompiler`). The code now passes its lint rules, so this should be low risk.
- [ ] 11 "moderate" `npm audit` warnings in Expo's build tooling (`glob`, `minimatch`). They don't ship in the app; update with the next Expo SDK.
- [ ] `react-native-tcp-socket` is flagged by `expo-doctor` as untested on the New Architecture, although it works on both test phones. Keep an eye on it when upgrading.

## Ideas
- [ ] **Offline mission: phone-made network.** On a plane there's no Wi-Fi router. An Android host could start a local-only hotspot and pass its name and password to joiners over Bluetooth; the iPhone joins with one tap. Needs a native module and a new build.
- [ ] **Skip duplicate uploads.** When the host already has a library song (same Navidrome id), the joiner shouldn't upload it again.
- [ ] Send artist, album and cover with each [[Session Protocol]] track, so the queue and now-playing look like a music app.
- [ ] Move the Navidrome token into `expo-secure-store` (next native build).
- [ ] Remember the display name between launches (e.g. with `expo-secure-store` or AsyncStorage).
- [ ] Drag-to-reorder in the [[Queue]] instead of up/down arrows.
- [ ] Show each listener's sync status (in sync, buffering, behind) next to their avatar.
- [ ] Host hand-off when the host leaves, instead of ending the session for everyone.
