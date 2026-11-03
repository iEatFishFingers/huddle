// Public types of nearby-session discovery (re-exported unchanged from ./index).

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

export type AdvertiseHandle = {
  update(info: AdvertisedSession): void;
  stop(): Promise<void>;
  /** Why nearby phones can't see this session right now, else null. Reflects the latest state. */
  readonly error: string | null;
};
