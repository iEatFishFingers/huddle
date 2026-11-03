# Development Setup

Back to [[Home]] · see also [[Testing]], [[Troubleshooting]]

## Why a development build
Huddle uses native modules: Bluetooth (`expo-ble-kit`), raw TCP for the [[Host Server]] (`react-native-tcp-socket`), and navigation. **Expo Go can't run it**, so each phone needs a **development build** of Huddle.

Builds run in the cloud with **EAS**, so no Xcode or Android Studio is needed. That's important here, because development is on Windows.

## One-time: install a build on each phone
```bash
npx eas-cli@latest login
npx eas-cli@latest build --profile development --platform android   # APK
npx eas-cli@latest device:create                                    # register an iPhone
npx eas-cli@latest build --profile development --platform ios       # paid Apple Developer account
```
- **iPhone:** turn on *Developer Mode* (Settings → Privacy & Security).
- **Install:** open the build page on the phone and tap Install. For Android, you can instead scan its QR code with the camera app.
- Profiles are in `eas.json`. `development` is an internal-distribution dev client, and an APK on Android.

## When to rebuild
| Change | Rebuild? |
| --- | --- |
| JS/TS code: screens, sync, queue | **No**, it reloads live |
| A new library with native code | **Yes** |
| `app.json`: permissions, plugins, icons | **Yes** |

If a phone shows `Cannot find native module …`, it's running an old build. See [[Troubleshooting]].

## Daily loop
```bash
npx expo start --dev-client
```
1. Open Huddle on each phone and connect to `http://<PC LAN IP>:8081` with **Enter URL manually**. The Android dev client's QR scanner can hang while "downloading barcode UI".
2. The phones and PC must share a Wi-Fi network (not a guest network).
3. Host on one phone and join from the other ([[Discovery]]).

## Config worth knowing
- `app.json` → `expo-build-properties` sets Android `usesCleartextTraffic: true`. Joiners use plain `ws://` and `http://` to the host's LAN IP.
- `app.json` → `expo-ble-kit` sets the Bluetooth permission text, Android `advertise: true` and `neverForLocation: true`.
- iOS: `NSLocalNetworkUsageDescription` and `NSAllowsLocalNetworking` for LAN access.
- Use `npx expo install <pkg>`, not `npm install`, so versions match SDK 58.
