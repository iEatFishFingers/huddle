import { Buffer } from 'buffer';
import TcpSocket from 'react-native-tcp-socket';
import { File, FileMode } from 'expo-file-system';
import { ClientMsg, ServerMsg } from '../protocol';
import { FrameParser, acceptKey, encodeFrame } from './ws';

type Socket = InstanceType<typeof TcpSocket.Socket>;

export type PeerServerHandlers = {
  /** Return false to refuse the peer (session full). */
  onJoin(peerId: string): boolean;
  onMessage(peerId: string, msg: ClientMsg): void;
  onLeave(peerId: string): void;
  /** Local file for a track id, or null. */
  resolveFile(trackId: string): { uri: string; name: string } | null;
};

const MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
};
const CHUNK = 64 * 1024;

const write = (s: Socket, data: Buffer | string) =>
  new Promise<void>((res, rej) => s.write(data as any, undefined, (err?: Error) => (err ? rej(err) : res())));

/** Minimal HTTP + WebSocket server: `/ws` carries the session protocol, `/audio/<id>` serves track files with Range support. */
export class PeerServer {
  private server?: ReturnType<typeof TcpSocket.createServer>;
  private peers = new Map<string, Socket>();
  private nextId = 1;

  constructor(private handlers: PeerServerHandlers) {}

  start(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = TcpSocket.createServer((socket: Socket) => this.accept(socket));
      this.server.on('error', reject);
      this.server.listen({ port, host: '0.0.0.0', reuseAddress: true }, () => resolve());
    });
  }

  stop() {
    this.peers.forEach((s) => s.destroy());
    this.peers.clear();
    this.server?.close();
  }

  send(peerId: string, msg: ServerMsg) {
    const s = this.peers.get(peerId);
    if (s) write(s, encodeFrame(0x1, Buffer.from(JSON.stringify(msg)))).catch(() => {});
  }

  broadcast(msg: ServerMsg) {
    for (const id of this.peers.keys()) this.send(id, msg);
  }

  private accept(socket: Socket) {
    let head = Buffer.alloc(0);
    let mode: 'http' | 'ws' | 'busy' = 'http';
    let parser: FrameParser | null = null;
    let peerId: string | null = null;

    socket.on('error', () => {});
    socket.on('close', () => {
      if (peerId && this.peers.get(peerId) === socket) {
        this.peers.delete(peerId);
        this.handlers.onLeave(peerId);
      }
    });

    socket.on('data', (chunk: any) => {
      const buf = Buffer.from(chunk);
      if (mode === 'ws') return this.onFrames(socket, parser!.push(buf), peerId!);
      head = Buffer.concat([head, buf]);
      if (mode === 'busy') return;
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) {
        if (head.length > 16 * 1024) socket.destroy();
        return;
      }
      mode = 'busy';
      const rest = Buffer.from(head.subarray(end + 4));
      const lines = Buffer.from(head.subarray(0, end)).toString('latin1').split('\r\n');
      const [method, target] = lines[0].split(' ');
      const headers: Record<string, string> = {};
      for (const l of lines.slice(1)) {
        const i = l.indexOf(':');
        if (i > 0) headers[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
      }

      if (target === '/ws' && headers['upgrade']?.toLowerCase() === 'websocket' && headers['sec-websocket-key']) {
        acceptKey(headers['sec-websocket-key'])
          .then(async (accept) => {
            await write(
              socket,
              `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
            );
            const id = `peer-${this.nextId++}`;
            if (!this.handlers.onJoin(id)) {
              // join() already refused; send close 1013 "session full"
              await write(socket, encodeFrame(0x8, Buffer.from([0x03, 0xf5])));
              return socket.destroy();
            }
            peerId = id;
            parser = new FrameParser();
            this.peers.set(id, socket);
            mode = 'ws';
            if (rest.length) this.onFrames(socket, parser.push(rest), id);
          })
          .catch(() => socket.destroy());
      } else if (method === 'GET' && target?.startsWith('/audio/')) {
        this.serveAudio(socket, decodeURIComponent(target.slice(7)), headers['range']).catch(() => socket.destroy());
      } else {
        write(socket, 'HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
          .then(() => socket.destroy())
          .catch(() => socket.destroy());
      }
    });
  }

  private onFrames(socket: Socket, frames: { opcode: number; payload: Buffer }[], peerId: string) {
    for (const f of frames) {
      if (f.opcode === 0x1) {
        try {
          this.handlers.onMessage(peerId, JSON.parse(f.payload.toString('utf8')));
        } catch {}
      } else if (f.opcode === 0x9) {
        write(socket, encodeFrame(0xa, f.payload)).catch(() => {});
      } else if (f.opcode === 0x8) {
        write(socket, encodeFrame(0x8, f.payload)).finally(() => socket.destroy());
      }
    }
  }

  private async serveAudio(socket: Socket, trackId: string, rangeHeader?: string) {
    const track = this.handlers.resolveFile(trackId);
    if (!track) {
      await write(socket, 'HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
      return socket.destroy();
    }
    const handle = new File(track.uri).open(FileMode.ReadOnly);
    try {
      const size = handle.size ?? 0;
      const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader ?? '');
      const start = m && m[1] ? Number(m[1]) : 0;
      const last = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      const ext = track.name.split('.').pop()?.toLowerCase() ?? '';
      const status = m ? '206 Partial Content' : '200 OK';
      let head = `HTTP/1.1 ${status}\r\nContent-Type: ${MIME[ext] ?? 'application/octet-stream'}\r\nAccept-Ranges: bytes\r\nContent-Length: ${last - start + 1}\r\nConnection: close\r\n`;
      if (m) head += `Content-Range: bytes ${start}-${last}/${size}\r\n`;
      await write(socket, head + '\r\n');

      handle.offset = start;
      for (let left = last - start + 1; left > 0; ) {
        const bytes = await handle.readBytes(Math.min(CHUNK, left));
        if (!bytes.length) break;
        await write(socket, Buffer.from(bytes));
        left -= bytes.length;
      }
    } finally {
      handle.close();
      socket.destroy();
    }
  }
}
