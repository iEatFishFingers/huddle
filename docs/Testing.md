# Testing

Back to [[Home]] · see also [[Development Setup]]

## Static checks
```bash
npm run check         # all of the below; run before every commit
npm run typecheck     # tsc --noEmit
npm run lint          # ESLint with eslint-config-expo, including the React hooks/Compiler rules
npm test              # HostCore unit tests
npx expo-doctor       # dependency/config health
```
`expo-doctor` warns that `react-native-tcp-socket` is untested on the New Architecture. That's known and fine: it works on both test phones.

The lint rules include React's compiler-readiness checks: no ref reads or writes during render, no `setState` directly in an effect body, no mutating `useState` values. The one deliberate exception is the `PanResponder` in `SeekBar.tsx`, which is commented in place.

## Unit tests
These have no test framework or extra dependencies. Each is a script you compile and run with Node.

- **[[HostCore]]** (`src/core/HostCore.test.ts`, 60 checks): join, hello and full; add with dedupe and auto-select; every [[Queue]] action; `ended` handling; pending play and its 8 s fallback ([[Readiness and Pending Play]]); seek clamping. Run it with `npm test`, which compiles to `.test-build/` (git-ignored) and runs it with Node.
- **[[Host Server]] helpers** (`src/server/http.ts`): request parsing, Range and upload checks. Tested during development with a scratch script that isn't committed yet.
- **[[Discovery]]**: tested against `expo-ble-kit/testing`, the library's simulated Bluetooth stack. That script isn't committed yet either.

## On real phones
The behaviour that matters (sync, Bluetooth, streaming) only shows up on hardware. Run through:
1. Host on the iPhone and join from Android via **Nearby sessions**. Then swap roles.
2. Add songs from the **joiner** ([[Uploads]]).
3. Play, pause, seek, next, previous, reorder and remove, from both phones.
4. Listen for echo or cut-outs, and watch the `[sync]` logs ([[Playback and Drift Correction#Logs]]).

See [[Troubleshooting]] for what the logs mean.
