import { Platform } from 'react-native';
import * as Network from 'expo-network';
import { HostCore } from '../HostCore';
import { HOST_PORT, ServerMsg, Track } from '../protocol';
import type { PeerServer } from '../server/PeerServer';
import { Transport } from './types';

const SELF = 'self';

/** The host device's own connection to its session, plus the on-phone server remote peers join through. */
export class LoopbackTransport implements Transport {
  private messageFn?: Parameters<Transport['onMessage']>[0];
  private statusFn?: Parameters<Transport['onStatus']>[0];
  private addressFn?: (address: string | null, error: string | null) => void;
  private server?: PeerServer;
  private baseUrl = '';

  private core = new HostCore({
    to: (id, msg) => (id === SELF ? this.deliver(msg) : this.server?.send(id, this.forRemote(msg))),
    all: (msg) => {
      this.deliver(msg);
      this.server?.broadcast(this.forRemote(msg));
    },
  });

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

  addTracks(tracks: Track[]) {
    this.core.addTracks(tracks);
  }

  /** Called with the join address once the server is up, or an error message if it can't start (e.g. Expo Go, web). */
  onAddress(fn: (address: string | null, error: string | null) => void) {
    this.addressFn = fn;
  }

  onMessage(fn: Parameters<Transport['onMessage']>[0]) {
    this.messageFn = fn;
  }

  onStatus(fn: Parameters<Transport['onStatus']>[0]) {
    this.statusFn = fn;
  }

  connect() {
    this.statusFn?.(true);
    this.core.join(SELF);
    this.startServer();
  }

  disconnect() {
    this.server?.stop();
    this.core.leave(SELF);
    this.statusFn?.(false);
  }

  send(msg: Parameters<Transport['send']>[0]) {
    this.core.handle(SELF, msg);
  }

  private async startServer() {
    if (Platform.OS === 'web') return this.addressFn?.(null, 'Joining this session needs the phone app (dev build).');
    try {
      const { PeerServer } = await import('../server/PeerServer');
      const ip = await Network.getIpAddressAsync();
      this.baseUrl = `http://${ip}:${HOST_PORT}`;
      this.server = new PeerServer({
        onJoin: (id) => this.core.join(id),
        onMessage: (id, msg) => this.core.handle(id, msg),
        onLeave: (id) => this.core.leave(id),
        resolveFile: (id) => {
          const t = this.core.tracks.find((x) => x.id === id);
          return t ? { uri: t.url, name: t.title } : null;
        },
      });
      await this.server.start(HOST_PORT);
      this.addressFn?.(ip, null);
    } catch (e) {
      this.addressFn?.(null, `Server unavailable (needs the Huddle dev build, not Expo Go): ${e}`);
    }
  }
}
