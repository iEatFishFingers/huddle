// Fixed identifiers and timings for Huddle's Bluetooth discovery. Pure: no native imports.

/** The Huddle GATT service; hosts advertise it, joiners scan for it. */
export const HUDDLE_SERVICE_UUID = '17cfe356-3ff6-41ff-b6ec-c823a78aaeed';
/** Readable characteristic: UTF-8 JSON of the AdvertisedSession (see codec.ts). */
export const SESSION_INFO_CHAR_UUID = 'dea9833d-8719-481a-87a6-0d6c20fd75c3';
/** Advertised local name (iOS only: Android advertises the phone's own Bluetooth name). */
export const ADVERTISED_NAME = 'Huddle';

export type ScannerTimings = {
  /** Drop a session after this long without an advertisement. */
  staleMs: number;
  /** Re-read a visible session's info this often (member counts). */
  refreshMs: number;
  /** connect() timeout. */
  connectTimeoutMs: number;
  /** discover()/read() timeout each. */
  opTimeoutMs: number;
  /** Hard cap on one whole connect → read → disconnect cycle. */
  watchdogMs: number;
  /** Cap on waiting for disconnect(), which has no timeout of its own. */
  disconnectTimeoutMs: number;
  /** First retry delay after a failed read; doubles per failure up to maxBackoffMs. */
  backoffMs: number;
  maxBackoffMs: number;
  /** Housekeeping tick (expiry + queue pump). */
  tickMs: number;
  /** Scan result batching window. */
  reportIntervalMs: number;
  /** Delay before restarting a scan that ended with a non-state error. */
  scanRetryMs: number;
};

export const DEFAULT_TIMINGS: ScannerTimings = {
  staleMs: 10_000,
  refreshMs: 15_000,
  connectTimeoutMs: 8_000,
  opTimeoutMs: 5_000,
  watchdogMs: 15_000,
  disconnectTimeoutMs: 3_000,
  backoffMs: 2_000,
  maxBackoffMs: 30_000,
  tickMs: 1_000,
  reportIntervalMs: 1_000,
  scanRetryMs: 5_000,
};

/** Max characters kept from names when encoding, so the JSON stays well under 512 bytes. */
export const MAX_NAME_LENGTH = 40;
