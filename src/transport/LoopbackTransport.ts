import { Platform } from 'react-native';
import * as Network from 'expo-network';
import { File } from 'expo-file-system';
import { HostCore } from '../HostCore';
import { HOST_PORT, ServerMsg, Track } from '../protocol';
import type { PeerServer, ServerErrorKind, UploadedFile } from '../server/PeerServer';
import { mimeForName } from '../server/http';
import { PickedFile, Transport } from './types';

const SELF = 'self';
/** If HOST_PORT is taken (e.g. a server leaked by a JS reload on Android), try the next few. */
const PORT_ATTEMPTS = 10;

export type HostAddress = { host: string; port: number };
export type { ServerErrorKind };

const titleOf = (name: string) => name.replace(/\.[^.]+$/, '') || name;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The host device's own connection to its session, plus the on-phone server remote peers join through. */
export class LoopbackTransport implements Transport {
  private messageFn?: Parameters<Transport['onMessage']>[0];
  private statusFn?: Parameters<Transport['onStatus']>[0];
  private addressFn?: (address: string | null, error: string | null) => void;
  private serverErrorFn?: (message: string, kind: ServerErrorKind | 'network') => void;
  private server?: PeerServer;
  private address: HostAddress | null = null;
  private lastAddress: [string | null, string | null] | null = null;
  private baseUrl = '';
  /** Bumped on every connect/disconnect so a slow startServer() can tell it was cancelled. */
  private generation = 0;
  /** Local file details per track id, for serving it with the right Content-Type. */
  private files = new Map<string, { uri: string; name: string; mimeType: string }>();
  private core: HostCore;

  constructor(opts: { sessionName: string }) {
    this.core = new HostCore(
      {
        to: (id, msg) => (id === SELF ? this.deliver(msg) : this.server?.send(id, this.forRemote(msg))),
        all: (msg) => {
          this.deliver(msg);
          this.server?.broadcast(this.forRemote(msg));
        },
      },
      { sessionName: opts.sessionName },
    );
  }

  private deliver(msg: ServerMsg) {
    queueMicrotask(() => this.messageFn?.(msg));
  }

  /** Remote peers fetch audio over HTTP; the host plays its local file directly. */
  private forRemote(msg: ServerMsg): ServerMsg {
    const remap = (tracks: Track[]) =>
      tracks.map((t) => ({ ...t, url: `${this.baseUrl}/audio/${encodeURIComponent(t.id)}` }));
    if (msg.type === 'welcome') return { ...msg, tracks: remap(msg.tracks) };
    if (msg.type === 'tracks') return { ...msg, tracks: remap(msg.tracks) };
    return msg;
  }

  private trackFor(uri: string, name: string, size: number, mimeType: string, addedBy: string, durationMs: number): Track {
    const id = `${name}-${size}`;
    if (!this.files.has(id)) this.files.set(id, { uri, name, mimeType: mimeType || mimeForName(name) });
    return { id, title: titleOf(name), url: uri, addedBy, durationMs: durationMs > 0 ? Math.round(durationMs) : 0 };
  }

  /** Host adds songs picked on this phone: registered directly, no copy. */
  async addFiles(files: PickedFile[], addedBy: string, onProgress?: (fraction: number) => void): Promise<void> {
    const tracks = files.map((f) => {
      let size = f.size;
      if (!size) {
        try {
          size = new File(f.uri).size ?? 0;
        } catch {}
      }
      return this.trackFor(f.uri, f.name, size, f.mimeType, addedBy, f.durationMs);
    });
    this.core.addTracks(tracks, { enqueue: true, addedByPeer: SELF });
    onProgress?.(1);
  }

  /** A joiner's upload finished (called by PeerServer). Returns the track id. */
  private onUpload(u: UploadedFile): string {
    const id = `${u.name}-${u.size}`;
    const existing = this.core.tracks.find((t) => t.id === id);
    if (existing) {
      // Same song already in the library: drop the duplicate copy and just queue it again.
      try {
        new File(u.fileUri).delete();
      } catch {}
      this.core.handle(SELF, { type: 'queue', action: 'add', trackId: id });
      return id;
    }
    const track = this.trackFor(u.fileUri, u.name, u.size, u.mimeType, u.addedBy, u.durationMs);
    this.core.addTracks([track], { enqueue: true });
    return id;
  }

  /**
   * Called with the join address once the server is up ("ip", or "ip:port" if HOST_PORT was taken),
   * or a readable error if it can't start. Fires immediately if that already happened.
   */
  onAddress(fn: (address: string | null, error: string | null) => void) {
    this.addressFn = fn;
    if (this.lastAddress) fn(...this.lastAddress);
  }

  /** Problems after (or while) starting: listen failures, socket errors, failed audio serving/uploads. */
  onServerError(fn: (message: string, kind: ServerErrorKind | 'network') => void) {
    this.serverErrorFn = fn;
  }

  /** Where joiners connect, once the server is listening. */
  getAddress(): HostAddress | null {
    return this.address;
  }

  memberCount(): number {
    return this.core.memberCount();
  }

  onMessage(fn: Parameters<Transport['onMessage']>[0]) {
    this.messageFn = fn;
  }

  onStatus(fn: Parameters<Transport['onStatus']>[0]) {
    this.statusFn = fn;
  }

  connect() {
    const gen = ++this.generation;
    this.statusFn?.(true);
    this.core.join(SELF, true);
    this.startServer(gen);
  }

  disconnect() {
    this.generation++;
    this.server?.stop();
    this.server = undefined;
    this.address = null;
    this.core.leave(SELF);
    this.statusFn?.(false);
  }

  send(msg: Parameters<Transport['send']>[0]) {
    this.core.handle(SELF, msg);
  }

  private setAddress(address: string | null, error: string | null) {
    this.lastAddress = [address, error];
    this.addressFn?.(address, error);
  }

  private fail(kind: ServerErrorKind | 'network', message: string) {
    console.warn(`[host] ${kind}: ${message}`);
    this.serverErrorFn?.(message, kind);
  }

  /** Pick the address joiners should use, or explain why there isn't a usable one. */
  private async localIp(): Promise<{ ip: string | null; warning: string | null }> {
    let ip = '0.0.0.0';
    try {
      ip = await Network.getIpAddressAsync();
    } catch (e) {
      this.fail('network', `getIpAddressAsync failed: ${errText(e)}`);
    }
    let type: string | undefined;
    try {
      type = String((await Network.getNetworkStateAsync()).type ?? '');
    } catch {}
    console.log(`[host] network type=${type} ip=${ip} platform=${Platform.OS}`);
    if (!ip || ip === '0.0.0.0' || ip.startsWith('127.') || ip.includes(':')) {
      return {
        ip: null,
        warning:
          'This phone has no Wi-Fi address. Connect to Wi-Fi (or turn on the hotspot and have friends join it) and host again.',
      };
    }
    // Android reports the address of the *default* network. When the phone is sharing a hotspot,
    // or on a Wi-Fi without internet, that's mobile data, whose address other phones can't reach.
    if (type === Network.NetworkStateType.CELLULAR) {
      return {
        ip,
        warning:
          `This phone is on mobile data (${ip}), which nearby phones can't reach. ` +
          "Join the same Wi-Fi as your friends. If you're sharing a hotspot, Android doesn't tell the app the hotspot address: " +
          'friends should enter it by hand (Settings > Hotspot, often 192.168.43.1 or 10.x.x.1).',
      };
    }
    return { ip, warning: null };
  }

  private async startServer(gen: number) {
    if (Platform.OS === 'web') {
      return this.setAddress(null, 'Hosting needs the phone app (dev build), not the web.');
    }
    let PeerServerCls: typeof PeerServer;
    try {
      PeerServerCls = (await import('../server/PeerServer')).PeerServer;
    } catch (e) {
      const msg = `Server unavailable (needs the Huddle dev build, not Expo Go): ${errText(e)}`;
      this.fail('listen', msg);
      return this.setAddress(null, msg);
    }
    const { ip, warning } = await this.localIp();
    if (gen !== this.generation) return;

    const server = new PeerServerCls({
      onJoin: (id) => this.core.join(id),
      onMessage: (id, msg) => this.core.handle(id, msg),
      onLeave: (id) => this.core.leave(id),
      resolveFile: (id) => {
        const f = this.files.get(id);
        if (f) return f;
        const t = this.core.tracks.find((x) => x.id === id);
        return t ? { uri: t.url, name: t.id } : null;
      },
      onUpload: (u) => this.onUpload(u),
      onError: (kind, message) => this.serverErrorFn?.(message, kind),
    });

    let port = 0;
    const errors: string[] = [];
    for (let i = 0; i < PORT_ATTEMPTS && !port; i++) {
      try {
        await server.start(HOST_PORT + i);
        port = HOST_PORT + i;
      } catch (e) {
        errors.push(errText(e));
        console.warn(`[host] listen: ${errText(e)}`);
        if (gen !== this.generation) return;
        // Timeouts mean the native module is broken, not that the port is busy: don't keep trying.
        if (/timed out/.test(errText(e))) break;
      }
    }
    if (gen !== this.generation) {
      server.stop(); // disconnect() happened while we were starting
      return;
    }
    if (!port) {
      const msg = `Couldn't start the session server: ${errors[errors.length - 1] ?? 'unknown error'}`;
      this.fail('listen', msg);
      return this.setAddress(null, msg);
    }
    this.server = server;
    console.log(`[host] listening on 0.0.0.0:${port}, advertising ${ip ?? '(no address)'}`);
    if (!ip) {
      this.fail('network', warning!);
      return this.setAddress(null, warning);
    }
    this.baseUrl = `http://${ip}:${port}`;
    this.address = { host: ip, port };
    // Peers that joined before baseUrl was known don't exist yet (the server wasn't listening), so no resend needed.
    if (warning) this.fail('network', warning);
    this.setAddress(port === HOST_PORT ? ip : `${ip}:${port}`, warning);
  }
}
