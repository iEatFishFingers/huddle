// Joiner side: scan for the Huddle service, read each host's session info over GATT (one connect at
// a time), keep the list fresh, drop hosts that stopped advertising. No React here: the hook in
// ./index wraps it, and scripts/tests can drive it with expo-ble-kit's fake.

import type { BleManagerApi, BleState, Peripheral, ScanResult, ScanSession, Subscription } from 'expo-ble-kit';

import { decodeSession } from './codec';
import { DEFAULT_TIMINGS, HUDDLE_SERVICE_UUID, SESSION_INFO_CHAR_UUID, type ScannerTimings } from './constants';
import { describeError, errorCode, JOIN_MESSAGES, messageForErrorCode, messageForState } from './messages';
import type { AdvertisedSession, NearbySession } from './types';

export type ScannerSnapshot = {
  sessions: NearbySession[];
  scanning: boolean;
  error: string | null;
};

type Entry = {
  id: string;
  rssi: number;
  lastSeen: number;
  info: AdvertisedSession | null;
  /** When info was last read successfully (0 = never). */
  lastRead: number;
  failures: number;
  /** Earliest time the next read attempt may run. */
  nextAttempt: number;
};

export type ScannerOptions = {
  timings?: Partial<ScannerTimings>;
  /** Android 11 and older only report scan results while Location is on. */
  checkLocationServices?: () => Promise<boolean>;
  now?: () => number;
};

const EMPTY: ScannerSnapshot = { sessions: [], scanning: false, error: null };

/**
 * Keyed by peripheral id; the published list is additionally de-duplicated by host:port, since
 * Android hosts rotate their random BLE address (new peripheral id, same session).
 */
export function buildSessionList(entries: Iterable<Entry>): NearbySession[] {
  const byAddress = new Map<string, { entry: Entry; info: AdvertisedSession }>();
  for (const entry of entries) {
    if (!entry.info) continue;
    const key = `${entry.info.host}:${entry.info.port}`;
    const existing = byAddress.get(key);
    if (!existing || entry.lastSeen > existing.entry.lastSeen) byAddress.set(key, { entry, info: entry.info });
  }
  return [...byAddress.values()]
    .map(({ entry, info }) => ({ id: entry.id, rssi: entry.rssi, ...info }))
    .sort((a, b) => b.rssi - a.rssi || a.sessionName.localeCompare(b.sessionName));
}

/** Removes entries not seen within staleMs. Returns true if any were removed. */
export function expireEntries(entries: Map<string, Entry>, now: number, staleMs: number): boolean {
  let removed = false;
  for (const [id, entry] of entries) {
    if (now - entry.lastSeen > staleMs) {
      entries.delete(id);
      removed = true;
    }
  }
  return removed;
}

/** The next entry whose read is due: never-read ones first, then the stalest refresh. */
export function pickDueEntry(entries: Iterable<Entry>, now: number, refreshMs: number): Entry | null {
  let best: Entry | null = null;
  let bestDue = Infinity;
  for (const entry of entries) {
    const due = entry.info ? Math.max(entry.lastRead + refreshMs, entry.nextAttempt) : entry.nextAttempt;
    if (due > now) continue;
    // Unknown sessions jump the queue: they are what the user is waiting to see.
    const rank = entry.info ? due : due - 1e12;
    if (rank < bestDue) {
      best = entry;
      bestDue = rank;
    }
  }
  return best;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export class NearbyScanner {
  private readonly t: ScannerTimings;
  private readonly now: () => number;
  private readonly entries = new Map<string, Entry>();
  private snapshot: ScannerSnapshot = EMPTY;
  private listeners = new Set<(s: ScannerSnapshot) => void>();

  private started = false;
  private disposed = false;
  private bleState: BleState | null = null;
  private permissionError: string | null = null;
  private scanError: string | null = null;
  private scan: ScanSession | null = null;
  private stateSub: Subscription | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private scanRetry: ReturnType<typeof setTimeout> | null = null;
  /** Bumped by rescan/restart so stale async work can tell it's outdated. */
  private generation = 0;

  private busy = false;
  private current: { peripheral: Peripheral; abort: AbortController } | null = null;

  constructor(
    private readonly ble: BleManagerApi | null,
    private readonly options: ScannerOptions = {},
  ) {
    this.t = { ...DEFAULT_TIMINGS, ...options.timings };
    this.now = options.now ?? Date.now;
  }

  getSnapshot(): ScannerSnapshot {
    return this.snapshot;
  }

  subscribe(listener: (s: ScannerSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Asks for permissions (prompts once), then scans whenever Bluetooth is on. */
  async start(): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;
    const ble = this.ble;
    if (!ble) {
      this.setError(JOIN_MESSAGES.unsupported);
      return;
    }
    try {
      const permissions = await withTimeout(ble.requestPermissionsAsync(), 60_000, 'requestPermissionsAsync');
      if (this.disposed) return;
      console.log(`[ble] scan permissions: scan=${permissions.scan} connect=${permissions.connect} canAskAgain=${permissions.canAskAgain}`);
      if (permissions.scan !== 'granted' || permissions.connect !== 'granted') {
        this.permissionError = JOIN_MESSAGES.unauthorized;
      }
    } catch (e) {
      if (this.disposed) return;
      console.warn(`[ble] requestPermissionsAsync failed: ${describeError(e)}`);
      const code = errorCode(e);
      if (code === 'NOT_SUPPORTED' || code === 'MISCONFIGURED') {
        this.setError(JOIN_MESSAGES.unsupported);
        return;
      }
      // Otherwise fall through: the adapter state below tells us more.
    }
    try {
      this.stateSub = ble.addStateListener((state) => this.onState(state));
      this.onState(ble.state);
    } catch (e) {
      console.warn(`[ble] cannot read Bluetooth state: ${describeError(e)}`);
      this.setError(JOIN_MESSAGES.unsupported);
      return;
    }
    this.ticker = setInterval(() => this.tick(), this.t.tickMs);
  }

  /** Pull-to-refresh: restart the scan and re-read everything visible now. */
  rescan(): void {
    if (this.disposed) return;
    console.log('[ble] rescan');
    for (const entry of this.entries.values()) {
      entry.failures = 0;
      entry.nextAttempt = 0;
      entry.lastRead = 0;
    }
    this.scanError = null;
    if (!this.started) {
      void this.start();
      return;
    }
    // A permission denial may have been fixed in Settings: ask again (no prompt if decided).
    if (this.permissionError && this.ble) {
      this.ble
        .requestPermissionsAsync()
        .then((p) => {
          if (p.scan === 'granted' && p.connect === 'granted') this.permissionError = null;
          this.restartScan();
        })
        .catch(() => this.restartScan());
      return;
    }
    this.restartScan();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.stopScan();
    this.stateSub?.remove();
    this.stateSub = null;
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.abortCurrent('dispose');
    this.entries.clear();
    this.listeners.clear();
  }

  // --- scanning -----------------------------------------------------------------------------

  private onState(state: BleState): void {
    if (this.disposed) return;
    if (state !== this.bleState) console.log(`[ble] adapter state: ${state}`);
    this.bleState = state;
    if (state === 'poweredOn') {
      // Scan even if a permission looked denied: a refused scan reports PERMISSION_DENIED (same
      // message), and an accepted one clears the error.
      this.restartScan();
    } else {
      this.stopScan();
      this.abortCurrent(`adapter ${state}`);
      if (state === 'poweredOff' || state === 'unauthorized' || state === 'unsupported') {
        this.entries.clear();
      }
      this.publish();
    }
  }

  private restartScan(): void {
    if (this.disposed || !this.ble) return;
    this.stopScan();
    if (this.bleState !== 'poweredOn') {
      this.publish();
      return;
    }
    void this.startScanIfAllowed(++this.generation);
  }

  private async startScanIfAllowed(generation: number): Promise<void> {
    const ble = this.ble!;
    if (this.options.checkLocationServices) {
      try {
        const on = await this.options.checkLocationServices();
        if (generation !== this.generation || this.disposed) return;
        if (!on) {
          console.warn('[ble] location services are off; Android <= 11 reports no scan results');
          this.scanError = JOIN_MESSAGES.locationOff;
          this.scheduleScanRetry();
          this.publish();
          return;
        }
      } catch (e) {
        console.warn(`[ble] isLocationServicesEnabled failed: ${describeError(e)}`);
      }
    }
    try {
      console.log('[ble] scan start');
      const session = ble.startScan(
        {
          services: [HUDDLE_SERVICE_UUID],
          allowDuplicates: true, // needed to notice hosts that went away
          reportIntervalMs: this.t.reportIntervalMs,
          android: { scanMode: 'balanced' },
        },
        (results) => this.onResults(results),
        (error) => {
          if (generation !== this.generation || this.disposed) return;
          console.warn(`[ble] scan ended: ${describeError(error)}`);
          this.scan = null;
          const code = errorCode(error);
          // State errors are followed by a state change, which restarts the scan.
          if (code === 'BLUETOOTH_POWERED_OFF' || code === 'BLUETOOTH_RESETTING') {
            this.publish();
            return;
          }
          this.scanError = messageForErrorCode(code, JOIN_MESSAGES);
          if (code !== 'PERMISSION_DENIED' && code !== 'BLUETOOTH_UNAUTHORIZED' && code !== 'MISCONFIGURED' && code !== 'NOT_SUPPORTED') {
            this.scheduleScanRetry();
          }
          this.publish();
        },
      );
      this.scan = session;
      this.scanError = null;
      this.permissionError = null; // the scan was accepted
    } catch (e) {
      console.warn(`[ble] startScan threw: ${describeError(e)}`);
      this.scanError = messageForErrorCode(errorCode(e), JOIN_MESSAGES);
      this.scheduleScanRetry();
    }
    this.publish();
  }

  private scheduleScanRetry(): void {
    if (this.scanRetry || this.disposed) return;
    this.scanRetry = setTimeout(() => {
      this.scanRetry = null;
      if (!this.disposed && !this.scan) this.restartScan();
    }, this.t.scanRetryMs);
  }

  private stopScan(): void {
    if (this.scanRetry) clearTimeout(this.scanRetry);
    this.scanRetry = null;
    if (this.scan) {
      console.log('[ble] scan stop');
      try {
        this.scan.stop();
      } catch (e) {
        console.warn(`[ble] scan stop failed: ${describeError(e)}`);
      }
    }
    this.scan = null;
  }

  private onResults(results: ScanResult[]): void {
    if (this.disposed) return;
    const now = this.now();
    for (const r of results) {
      let entry = this.entries.get(r.id);
      if (!entry) {
        console.log(`[ble] found host ${r.id} name=${r.name ?? '-'} rssi=${r.rssi}`);
        entry = { id: r.id, rssi: r.rssi, lastSeen: now, info: null, lastRead: 0, failures: 0, nextAttempt: 0 };
        this.entries.set(r.id, entry);
      }
      entry.lastSeen = now;
      // Smooth RSSI so the list doesn't reshuffle on every advertisement.
      entry.rssi = Math.round(entry.rssi * 0.7 + r.rssi * 0.3);
    }
    this.pump();
  }

  private tick(): void {
    if (this.disposed) return;
    if (expireEntries(this.entries, this.now(), this.t.staleMs)) {
      console.log('[ble] dropped hosts no longer advertising');
    }
    this.publish();
    this.pump();
  }

  // --- reading session info (one connection at a time) -------------------------------------------

  private pump(): void {
    if (this.busy || this.disposed || !this.scan || !this.ble) return;
    const entry = pickDueEntry(this.entries.values(), this.now(), this.t.refreshMs);
    if (!entry) return;
    this.busy = true;
    const generation = this.generation;
    void this.readEntry(entry).finally(() => {
      this.busy = false;
      this.current = null;
      if (!this.disposed && generation === this.generation) this.publish();
      // Next one on a fresh tick, so a fast-failing device can't spin the loop.
      if (!this.disposed) setTimeout(() => this.pump(), 0);
    });
  }

  private async readEntry(entry: Entry): Promise<void> {
    const ble = this.ble!;
    const abort = new AbortController();
    const signal = abort.signal;
    let peripheral: Peripheral;
    try {
      peripheral = ble.getPeripheral(entry.id);
    } catch (e) {
      this.recordFailure(entry, e);
      return;
    }
    this.current = { peripheral, abort };
    const started = this.now();
    const work = (async () => {
      await peripheral.connect({ timeoutMs: this.t.connectTimeoutMs, autoDiscover: false, signal });
      await peripheral.discover([HUDDLE_SERVICE_UUID], { timeoutMs: this.t.opTimeoutMs, signal });
      return peripheral.read(HUDDLE_SERVICE_UUID, SESSION_INFO_CHAR_UUID, { timeoutMs: this.t.opTimeoutMs, signal });
    })();
    work.catch(() => {}); // the watchdog may win the race; don't leave an unhandled rejection
    try {
      const bytes = await withTimeout(work, this.t.watchdogMs, 'session read');
      const info = decodeSession(bytes);
      if (!info) throw new Error(`malformed session info (${bytes.length} bytes)`);
      if (this.disposed) return;
      const live = this.entries.get(entry.id);
      if (live) {
        live.info = info;
        live.lastRead = this.now();
        live.failures = 0;
        live.nextAttempt = 0;
      }
      console.log(
        `[ble] read ${entry.id} in ${this.now() - started} ms: "${info.sessionName}" ${info.host}:${info.port} ${info.members}/${info.maxMembers}`,
      );
    } catch (e) {
      if (!this.disposed) this.recordFailure(entry, e);
    } finally {
      abort.abort();
      try {
        await withTimeout(peripheral.disconnect(), this.t.disconnectTimeoutMs, 'disconnect');
      } catch (e) {
        console.warn(`[ble] disconnect ${entry.id}: ${describeError(e)}`);
      }
    }
  }

  private recordFailure(entry: Entry, e: unknown): void {
    const live = this.entries.get(entry.id);
    if (!live) return;
    live.failures++;
    const delay = Math.min(this.t.maxBackoffMs, this.t.backoffMs * 2 ** (live.failures - 1));
    live.nextAttempt = this.now() + delay;
    console.warn(`[ble] read ${entry.id} failed (#${live.failures}, retry in ${delay} ms): ${describeError(e)}`);
  }

  private abortCurrent(reason: string): void {
    const current = this.current;
    if (!current) return;
    console.log(`[ble] cancelling read of ${current.peripheral.id} (${reason})`);
    current.abort.abort();
    current.peripheral.disconnect().catch(() => {});
  }

  // --- state out --------------------------------------------------------------------------------

  private setError(error: string): void {
    this.scanError = error;
    this.publish();
  }

  private publish(): void {
    if (this.disposed) return;
    const stateError = this.bleState ? messageForState(this.bleState, JOIN_MESSAGES) : null;
    const error = stateError ?? this.permissionError ?? this.scanError;
    const sessions = buildSessionList(this.entries.values());
    const next: ScannerSnapshot = { sessions, scanning: this.scan !== null && this.scan.active !== false, error };
    if (JSON.stringify(next) === JSON.stringify(this.snapshot)) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener(next);
  }
}
