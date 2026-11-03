// Host side: a GATT server with one readable "session info" characteristic, plus an advertisement
// carrying only the Huddle service UUID (all iOS can advertise). Joiners connect and read the JSON.

import {
  BleError,
  BleErrorCode,
  normalizeUUID,
  type Advertisement,
  type BleManagerApi,
  type BleState,
  type GattServer,
  type Subscription,
} from 'expo-ble-kit';

import { devLog } from '../log';
import { encodeSession, validateSession } from './codec';
import { ADVERTISED_NAME, HUDDLE_SERVICE_UUID, SESSION_INFO_CHAR_UUID } from './constants';
import { describeError, errorCode, HOST_MESSAGES, messageForErrorCode, messageForState } from './messages';
import type { AdvertisedSession, AdvertiseHandle } from './types';

/**
 * Some Android stacks stop connectable advertising once a central connects. If the first device
 * test shows Android hosts vanishing ~10 s after a joiner read them, set this to e.g. 3000 to
 * restart advertising that long after the last read. Off by default: a restart can rotate the
 * host's address, which makes joiners re-read it.
 */
const REARM_ADVERTISING_AFTER_READ_MS = 0;
const STEP_TIMEOUT_MS = 10_000;

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

/** Only one host at a time: the library allows one GATT server and one advertisement. */
let active: HostAdvertiser | null = null;

export type HostPlatform = 'ios' | 'android';

class HostAdvertiser implements AdvertiseHandle {
  private value: Uint8Array;
  private currentError: string | null = null;
  private stopped = false;
  private server: GattServer | null = null;
  private advertisement: Advertisement | null = null;
  private readSub: Subscription | null = null;
  private stateSub: Subscription | null = null;
  private rearmTimer: ReturnType<typeof setTimeout> | null = null;
  /** Serializes bring-up/tear-down so state flaps can't interleave them. */
  private queue: Promise<void> = Promise.resolve();
  private readonly charUuid = normalizeUUID(SESSION_INFO_CHAR_UUID);

  constructor(
    private readonly ble: BleManagerApi,
    info: AdvertisedSession,
    private readonly platform: HostPlatform,
  ) {
    this.value = encodeSession(info);
  }

  get error(): string | null {
    return this.currentError;
  }

  update(info: AdvertisedSession): void {
    if (this.stopped) return;
    if (!validateSession(info)) {
      console.warn(`[ble] ignoring invalid session update: ${JSON.stringify(info)}`);
      return;
    }
    this.value = encodeSession(info);
  }

  async init(): Promise<void> {
    try {
      const p = await withTimeout(
        this.ble.requestPermissionsAsync({ connect: true, advertise: true }),
        60_000,
        'requestPermissionsAsync',
      );
      devLog(`[ble] host permissions: connect=${p.connect} advertise=${p.advertise} canAskAgain=${p.canAskAgain}`);
      if (p.connect !== 'granted' || p.advertise !== 'granted') {
        this.currentError = HOST_MESSAGES.unauthorized;
        return;
      }
    } catch (e) {
      console.warn(`[ble] host requestPermissionsAsync failed: ${describeError(e)}`);
      this.currentError = messageForErrorCode(errorCode(e), HOST_MESSAGES);
      if (errorCode(e) === 'NOT_SUPPORTED' || errorCode(e) === 'MISCONFIGURED') return;
    }
    if (this.stopped) return;
    try {
      this.stateSub = this.ble.addStateListener((state) => this.onState(state));
      this.onState(this.ble.state);
      await this.queue; // the first bring-up, so `error` is meaningful when advertiseSession resolves
    } catch (e) {
      console.warn(`[ble] host cannot read Bluetooth state: ${describeError(e)}`);
      this.currentError = HOST_MESSAGES.unsupported;
    }
  }

  private onState(state: BleState): void {
    if (this.stopped) return;
    devLog(`[ble] host adapter state: ${state}`);
    if (state === 'poweredOn') {
      this.enqueue(() => this.bringUp());
    } else {
      const message = messageForState(state, HOST_MESSAGES);
      if (message) this.currentError = message;
      // Bluetooth off closes the server and advertisement natively; drop our handles too.
      this.enqueue(() => this.tearDown());
    }
  }

  private enqueue(step: () => Promise<void>): void {
    this.queue = this.queue.then(step).catch((e) => console.warn(`[ble] host step failed: ${describeError(e)}`));
  }

  private async bringUp(): Promise<void> {
    if (this.stopped || this.advertisement) return;
    try {
      if (!this.server) {
        const server = await withTimeout(
          this.ble.openGattServer([
            {
              uuid: HUDDLE_SERVICE_UUID,
              characteristics: [{ uuid: SESSION_INFO_CHAR_UUID, properties: ['read'], permissions: ['readable'] }],
            },
          ]),
          STEP_TIMEOUT_MS,
          'openGattServer',
        );
        this.server = server;
        this.readSub = server.onReadRequest(({ characteristic, centralId }) => {
          if (normalizeUUID(characteristic) !== this.charUuid) {
            throw new BleError(BleErrorCode.READ_NOT_PERMITTED, 'Not readable');
          }
          devLog(`[ble] host: session info read by ${centralId}`);
          this.scheduleRearm();
          return this.value;
        });
        devLog('[ble] host: GATT server open');
        if (this.stopped) return; // stop() runs tearDown after us in the queue
      }
      this.advertisement = await withTimeout(
        this.ble.startAdvertising(
          {
            serviceUUIDs: [HUDDLE_SERVICE_UUID],
            // Android would advertise the phone's own Bluetooth name, which can overflow the 31-byte
            // scan response; joiners filter by service UUID, so leave it out there.
            ...(this.platform === 'ios' ? { localName: ADVERTISED_NAME } : {}),
          },
          { connectable: true, android: { mode: 'balanced', txPower: 'medium' } },
        ),
        STEP_TIMEOUT_MS,
        'startAdvertising',
      );
      devLog('[ble] host: advertising');
      this.currentError = null;
    } catch (e) {
      console.warn(`[ble] host bring-up failed: ${describeError(e)}`);
      this.currentError = messageForErrorCode(errorCode(e), HOST_MESSAGES);
    }
  }

  private async tearDown(): Promise<void> {
    if (this.rearmTimer) clearTimeout(this.rearmTimer);
    this.rearmTimer = null;
    const advertisement = this.advertisement;
    const server = this.server;
    this.advertisement = null;
    this.server = null;
    this.readSub?.remove();
    this.readSub = null;
    if (advertisement) {
      try {
        await withTimeout(advertisement.stop(), STEP_TIMEOUT_MS, 'stopAdvertising');
        devLog('[ble] host: advertising stopped');
      } catch (e) {
        console.warn(`[ble] host stopAdvertising: ${describeError(e)}`);
      }
    }
    if (server) {
      try {
        await withTimeout(server.close(), STEP_TIMEOUT_MS, 'closeGattServer');
        devLog('[ble] host: GATT server closed');
      } catch (e) {
        console.warn(`[ble] host close server: ${describeError(e)}`);
      }
    }
  }

  private scheduleRearm(): void {
    if (REARM_ADVERTISING_AFTER_READ_MS <= 0 || this.platform !== 'android') return;
    if (this.rearmTimer) clearTimeout(this.rearmTimer);
    this.rearmTimer = setTimeout(() => {
      this.rearmTimer = null;
      this.enqueue(async () => {
        const advertisement = this.advertisement;
        if (this.stopped || !advertisement) return;
        this.advertisement = null;
        await advertisement.stop().catch(() => {});
        devLog('[ble] host: re-arming advertising');
        await this.bringUp();
      });
    }, REARM_ADVERTISING_AFTER_READ_MS);
  }

  async stop(): Promise<void> {
    if (this.stopped) return this.queue;
    this.stopped = true;
    this.stateSub?.remove();
    this.stateSub = null;
    this.enqueue(() => this.tearDown());
    if (active === this) active = null;
    await this.queue;
  }
}

function inertHandle(error: string): AdvertiseHandle {
  return { update() {}, stop: async () => {}, error };
}

export async function startHosting(
  ble: BleManagerApi | null,
  info: AdvertisedSession,
  platform: HostPlatform | null,
): Promise<AdvertiseHandle> {
  if (!ble || !platform) return inertHandle(HOST_MESSAGES.unsupported);
  if (!validateSession(info)) {
    console.warn(`[ble] not advertising invalid session info: ${JSON.stringify(info)}`);
    return inertHandle(HOST_MESSAGES.failed);
  }
  if (active) {
    devLog('[ble] host: stopping the previous advertisement first');
    await active.stop();
  }
  const host = new HostAdvertiser(ble, info, platform);
  active = host;
  await host.init();
  return host;
}
