// Nearby-session discovery over Bluetooth LE. Audio still travels over Wi-Fi/hotspot;
// Bluetooth only tells joiners where the host is.
//
// CONTRACT (the UI only uses what is exported here):
//   NearbySession, AdvertisedSession, DiscoveryState, useNearbySessions(), advertiseSession(info).
//
// How it works: the host opens a GATT server (service HUDDLE_SERVICE_UUID, one readable
// characteristic holding the session JSON) and advertises the service UUID. Joiners scan for that
// UUID, connect to each host one at a time, read the JSON, disconnect, and re-read every ~15 s.
// Logs are prefixed with [ble].

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { BleManager, type BleManagerApi } from 'expo-ble-kit';

import { startHosting, type HostPlatform } from './advertiser';
import { HOST_MESSAGES } from './messages';
import { NearbyScanner, type ScannerSnapshot } from './scanner';
import type { AdvertisedSession, AdvertiseHandle, DiscoveryState } from './types';

export type { NearbySession, AdvertisedSession, DiscoveryState, AdvertiseHandle } from './types';
export { HUDDLE_SERVICE_UUID, SESSION_INFO_CHAR_UUID } from './constants';

let warnedMissing = false;

/** The BLE manager, or null on web / when the native module isn't in this build. Never throws. */
function getBle(): BleManagerApi | null {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  try {
    void BleManager.state; // throws NOT_SUPPORTED when the native module is missing
    return BleManager;
  } catch (e) {
    if (!warnedMissing) {
      warnedMissing = true;
      console.warn(`[ble] Bluetooth unavailable (needs a development build with expo-ble-kit): ${String(e)}`);
    }
    return null;
  }
}

function hostPlatform(): HostPlatform | null {
  return Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : null;
}

/** Android 11 and older only deliver scan results while Location is on. */
function locationCheck(ble: BleManagerApi | null): (() => Promise<boolean>) | undefined {
  if (!ble || Platform.OS !== 'android' || typeof Platform.Version !== 'number' || Platform.Version >= 31) {
    return undefined;
  }
  return () => ble.android.isLocationServicesEnabled();
}

const INITIAL: ScannerSnapshot = { sessions: [], scanning: false, error: null };

/** Scan for nearby sessions while the calling screen is mounted. */
export function useNearbySessions(): DiscoveryState {
  const [snapshot, setSnapshot] = useState<ScannerSnapshot>(INITIAL);
  const scannerRef = useRef<NearbyScanner | null>(null);

  useEffect(() => {
    const ble = getBle();
    const scanner = new NearbyScanner(ble, { checkLocationServices: locationCheck(ble) });
    scannerRef.current = scanner;
    const unsubscribe = scanner.subscribe(setSnapshot);
    void scanner.start();
    return () => {
      unsubscribe();
      scanner.dispose();
      if (scannerRef.current === scanner) scannerRef.current = null;
    };
  }, []);

  const rescan = useCallback(() => scannerRef.current?.rescan(), []);
  return { sessions: snapshot.sessions, scanning: snapshot.scanning, error: snapshot.error, rescan };
}

/**
 * Host side: advertise this session until `stop()` is called. Call `update()` when members change.
 * Resolves with a handle even if Bluetooth is unavailable; `error` then says why (hosting still works,
 * people can join by address). `error` is live: it changes if Bluetooth is turned off/on later.
 * Starting a new advertisement stops the previous one.
 */
export async function advertiseSession(
  info: AdvertisedSession,
): Promise<{ update(info: AdvertisedSession): void; stop(): Promise<void>; error: string | null }> {
  try {
    const handle: AdvertiseHandle = await startHosting(getBle(), info, hostPlatform());
    return handle;
  } catch (e) {
    console.warn(`[ble] advertiseSession failed: ${String(e)}`);
    return {
      update() {},
      stop: async () => {},
      error: HOST_MESSAGES.failed,
    };
  }
}
