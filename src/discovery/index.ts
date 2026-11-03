// Nearby-session discovery over Bluetooth LE. Audio still travels over Wi-Fi/hotspot;
// Bluetooth only tells joiners where the host is.
//
// CONTRACT (implemented by the discovery agent; the UI only uses what is exported here):

export type NearbySession = {
  /** Stable while the host keeps advertising (BLE peripheral id). */
  id: string;
  sessionName: string;
  hostName: string;
  /** IPv4 address + port to open the WebSocket on. */
  host: string;
  port: number;
  /** Listeners currently in the session (including host). */
  members: number;
  maxMembers: number;
  /** Signal strength, for sorting (higher = closer). */
  rssi: number;
};

export type AdvertisedSession = Omit<NearbySession, 'id' | 'rssi'>;

export type DiscoveryState = {
  sessions: NearbySession[];
  scanning: boolean;
  /** User-facing reason scanning can't run (Bluetooth off, permission denied, unsupported), else null. */
  error: string | null;
  /** Restart the scan (e.g. pull-to-refresh). */
  rescan: () => void;
};

/** Scan for nearby sessions while the calling screen is mounted. */
export function useNearbySessions(): DiscoveryState {
  return { sessions: [], scanning: false, error: 'Discovery not implemented yet', rescan: () => {} };
}

/**
 * Host side: advertise this session until `stop()` is called. Call `update()` when members change.
 * Resolves with a handle even if Bluetooth is unavailable; `error` then says why (hosting still works,
 * people can join by address).
 */
export async function advertiseSession(
  _info: AdvertisedSession,
): Promise<{ update(info: AdvertisedSession): void; stop(): Promise<void>; error: string | null }> {
  return { update() {}, stop: async () => {}, error: 'Discovery not implemented yet' };
}
