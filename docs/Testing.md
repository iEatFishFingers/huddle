# Testing

Back to [[Home]] · see also [[Development Setup]]

## Static checks
```bash
npx tsc --noEmit      # typecheck (run before every commit)
npx expo-doctor       # dependency/config health
```
`expo-doctor` warns that `react-native-tcp-socket` is untested on the New Architecture. That's known and fine: it works on both test phones.

There's no ESLint config yet. `npx expo lint` would scaffold one.

## Unit tests
These have no test framework or extra dependencies. Each is a script you compile and run with Node.

- **[[HostCore]]** (`src/core/HostCore.test.ts`, 60 checks): join, hello and full; add with dedupe and auto-select; every [[Queue]] action; `ended` handling; pending play and its 8 s fallback ([[Readiness and Pending Play]]); seek clamping.
  ```bash
  npx tsc src/core/HostCore.test.ts --ignoreConfig --rootDir src --outDir <scratch> \
    --module commonjs --target es2022 --skipLibCheck --strict
  node <scratch>/core/HostCore.test.js
  ```
- **[[Host Server]] helpers** (`src/server/http.ts`): request parsing, Range and upload checks. Tested during development with a scratch script that isn't committed yet.
- **[[Discovery]]**: tested against `expo-ble-kit/testing`, the library's simulated Bluetooth stack. That script isn't committed yet either.

## On real phones
The behaviour that matters (sync, Bluetooth, streaming) only shows up on hardware. Run through:
1. Host on the iPhone and join from Android via **Nearby sessions**. Then swap roles.
2. Add songs from the **joiner** ([[Uploads]]).
3. Play, pause, seek, next, previous, reorder and remove, from both phones.
4. Listen for echo or cut-outs, and watch the `[sync]` logs ([[Playback and Drift Correction#Logs]]).

See [[Troubleshooting]] for what the logs mean.
