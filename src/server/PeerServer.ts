import { Buffer } from 'buffer';
import TcpSocket from 'react-native-tcp-socket';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import type { FileHandle } from 'expo-file-system';
import { ClientMsg, MAX_UPLOAD_BYTES, ServerMsg, UPLOAD_PATH } from '../protocol';
import { FrameParser, acceptKey, encodeFrame } from './ws';
import { checkUpload, mimeForName, parseRange, parseRequestHead, simpleResponse } from './http';

type Socket = InstanceType<typeof TcpSocket.Socket>;

export type UploadedFile = {
  /** file:// URI of the stored upload (in the cache dir). */
  fileUri: string;
  /** Original file name, e.g. "Song.mp3". */
  name: string;
  mimeType: string;
  addedBy: string;
  durationMs: number;
  size: number;
};

export type ServerErrorKind = 'listen' | 'socket' | 'audio' | 'upload';

export type PeerServerHandlers = {
  /** Return false to refuse the peer (session full). */
  onJoin(peerId: string): boolean;
  onMessage(peerId: string, msg: ClientMsg): void;
  onLeave(peerId: string): void;
  /** Local file for a track id, or null. */
  resolveFile(trackId: string): { uri: string; name: string; mimeType?: string } | null;
  /** A joiner finished uploading a song. Return the track id it now has (throw to reply 500). */
  onUpload(file: UploadedFile): string;
  /** Something went wrong after start(); for logging / surfacing in the UI. */
  onError?(kind: ServerErrorKind, message: string): void;
};

const CHUNK = 64 * 1024;
const LISTEN_TIMEOUT_MS = 5000;
/** Pause reading an upload while this many chunk writes are queued (back-pressure). */
const UPLOAD_HIGH_WATER = 8;

const write = (s: Socket, data: Buffer | string) =>
  new Promise<void>((res, rej) => s.write(data as any, undefined, (err?: Error) => (err ? rej(err) : res())));

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Minimal HTTP + WebSocket server: `/ws` carries the session protocol, `/audio/<id>` serves
 * track files with Range support, `POST /upload` lets joiners add songs.
 */
export class PeerServer {
  private server?: ReturnType<typeof TcpSocket.createServer>;
  private peers = new Map<string, Socket>();
  private sockets = new Set<Socket>();
  private nextId = 1;
  private uploadSeq = 0;
  private stopped = false;
  port = 0;

  constructor(private handlers: PeerServerHandlers) {}

  private report(kind: ServerErrorKind, message: string) {
    console.warn(`[host] ${kind}: ${message}`);
    this.handlers.onError?.(kind, message);
  }

  /** Listen on `port`; rejects with a readable Error (e.g. "Address already in use"). */
  start(port: number): Promise<void> {
    this.stopped = false;
    return new Promise((resolve, reject) => {
      let settled = false;
      const server = TcpSocket.createServer((socket: Socket) => this.accept(socket));
      this.server = server;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          server.close();
        } catch {}
        reject(new Error(`listen on port ${port} timed out (native TCP module never answered)`));
      }, LISTEN_TIMEOUT_MS);
      server.on('error', (e: unknown) => {
        // The native module reports errors as plain strings.
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`listen on port ${port} failed: ${errText(e)}`));
        } else if (!this.stopped) {
          this.report('listen', `server error: ${errText(e)}`);
        }
      });
      server.listen({ port, host: '0.0.0.0', reuseAddress: true }, () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.port = port;
        resolve();
      });
    });
  }

  stop() {
    this.stopped = true;
    this.sockets.forEach((s) => s.destroy());
    this.sockets.clear();
    this.peers.clear();
    try {
      this.server?.close();
    } catch {}
    this.server = undefined;
  }

  send(peerId: string, msg: ServerMsg) {
    const s = this.peers.get(peerId);
    if (s) write(s, encodeFrame(0x1, Buffer.from(JSON.stringify(msg)))).catch(() => {});
  }

  broadcast(msg: ServerMsg) {
    if (!this.peers.size) return;
    const frame = encodeFrame(0x1, Buffer.from(JSON.stringify(msg)));
    for (const s of this.peers.values()) write(s, frame).catch(() => {});
  }

  private accept(socket: Socket) {
    let head = Buffer.alloc(0);
    let mode: 'http' | 'ws' | 'upload' | 'busy' = 'http';
    let parser: FrameParser | null = null;
    let peerId: string | null = null;
    let upload: UploadSink | null = null;
    this.sockets.add(socket);

    socket.on('error', (e: unknown) => {
      // Peers vanishing (Wi-Fi drop, app killed) land here too; log, and tell the UI via onError.
      if (!this.stopped) this.report('socket', `${peerId ?? mode} socket error: ${errText(e)}`);
    });
    socket.on('close', () => {
      this.sockets.delete(socket);
      if (upload && !upload.finished) {
        upload.abort();
        if (!this.stopped) this.report('upload', `upload of "${upload.name}" was interrupted`);
      }
      if (peerId && this.peers.get(peerId) === socket) {
        this.peers.delete(peerId);
        this.handlers.onLeave(peerId);
      }
    });

    socket.on('data', (chunk: any) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'base64') : Buffer.from(chunk);
      if (mode === 'ws') return this.onFrames(socket, parser!.push(buf), peerId!);
      if (mode === 'upload') return upload!.push(buf);
      if (mode === 'busy') return;
      head = Buffer.concat([head, buf]);
      const req = parseRequestHead(head);
      if (req === null) return;
      if (req === 'too-large') return socket.destroy();
      head = Buffer.alloc(0);
      mode = 'busy';
      const { method, path, headers, rest } = req;

      if (path === '/ws' && headers['upgrade']?.toLowerCase() === 'websocket' && headers['sec-websocket-key']) {
        acceptKey(headers['sec-websocket-key'])
          .then(async (accept) => {
            await write(
              socket,
              `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
            );
            const id = `peer-${this.nextId++}`;
            if (!this.handlers.onJoin(id)) {
              // join() already refused; send close 1013 "try again later" (session full)
              await write(socket, encodeFrame(0x8, Buffer.from([0x03, 0xf5])));
              return socket.destroy();
            }
            peerId = id;
            parser = new FrameParser();
            this.peers.set(id, socket);
            mode = 'ws';
            if (rest.length) this.onFrames(socket, parser.push(rest), id);
          })
          .catch((e) => {
            this.report('socket', `WebSocket handshake failed: ${errText(e)}`);
            socket.destroy();
          });
      } else if (method === 'GET' && path.startsWith('/audio/')) {
        const id = path.slice(7);
        this.serveAudio(socket, id, headers['range']).catch((e) => {
          this.report('audio', `serving "${id}" failed: ${errText(e)}`);
          socket.destroy();
        });
      } else if (method === 'POST' && path === UPLOAD_PATH) {
        const check = checkUpload(req, MAX_UPLOAD_BYTES);
        if (!check.ok) {
          this.report('upload', `rejected upload (${check.status}): ${check.reason}`);
          // Don't read the body; reply and hang up (the client sees the status or a reset).
          return this.reply(socket, check.status, JSON.stringify({ error: check.reason }), 'application/json');
        }
        try {
          upload = new UploadSink(socket, check, `${Date.now()}-${this.uploadSeq++}`, (sink) =>
            this.finishUpload(socket, sink),
          );
        } catch (e) {
          this.report('upload', `could not create upload file: ${errText(e)}`);
          return this.reply(socket, 500, JSON.stringify({ error: 'host could not store the file' }), 'application/json');
        }
        mode = 'upload';
        if (rest.length) upload.push(rest);
      } else if (method === 'GET' && (path === '/' || path === '/health')) {
        this.reply(socket, 200, 'huddle');
      } else {
        this.reply(socket, 404);
      }
    });
  }

  private reply(socket: Socket, status: number, body = '', type?: string) {
    write(socket, simpleResponse(status, body, type))
      .catch(() => {})
      .finally(() => socket.destroy());
  }

  private async finishUpload(socket: Socket, sink: UploadSink) {
    if (sink.error) {
      this.report('upload', `writing "${sink.name}" failed: ${errText(sink.error)}`);
      sink.deleteFile();
      return this.reply(socket, 500, JSON.stringify({ error: 'host could not store the file' }), 'application/json');
    }
    try {
      const trackId = this.handlers.onUpload({
        fileUri: sink.file.uri,
        name: sink.name,
        mimeType: sink.mimeType,
        addedBy: sink.addedBy,
        durationMs: sink.durationMs,
        size: sink.length,
      });
      this.reply(socket, 200, JSON.stringify({ trackId }), 'application/json');
    } catch (e) {
      this.report('upload', `adding "${sink.name}" failed: ${errText(e)}`);
      sink.deleteFile();
      this.reply(socket, 500, JSON.stringify({ error: errText(e) }), 'application/json');
    }
  }

  private onFrames(socket: Socket, frames: { opcode: number; payload: Buffer }[], peerId: string) {
    for (const f of frames) {
      if (f.opcode === 0x1) {
        let msg: ClientMsg;
        try {
          msg = JSON.parse(f.payload.toString('utf8'));
        } catch {
          continue;
        }
        try {
          this.handlers.onMessage(peerId, msg);
        } catch (e) {
          this.report('socket', `handling ${(msg as any)?.type} from ${peerId} threw: ${errText(e)}`);
        }
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
      await write(socket, simpleResponse(404));
      return socket.destroy();
    }
    const file = new File(track.uri);
    let handle: FileHandle;
    try {
      handle = file.open(FileMode.ReadOnly);
    } catch (e) {
      throw new Error(`cannot open ${track.uri}: ${errText(e)}`);
    }
    try {
      // handle.size can be null for some providers (e.g. Android content:// URIs); fall back to File.size.
      let size = handle.size ?? 0;
      if (!size) size = file.size ?? 0;
      const type = track.mimeType || mimeForName(track.name) || mimeForName(track.uri);
      const range = size > 0 ? parseRange(rangeHeader, size) : null;
      if (range === 'unsatisfiable') {
        await write(
          socket,
          `HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */${size}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`,
        );
        return;
      }
      let head: string;
      let left: number;
      if (size > 0) {
        const start = range ? range.start : 0;
        const last = range ? range.end : size - 1;
        left = last - start + 1;
        head =
          `HTTP/1.1 ${range ? '206 Partial Content' : '200 OK'}\r\nContent-Type: ${type}\r\nAccept-Ranges: bytes\r\n` +
          `Content-Length: ${left}\r\nConnection: close\r\n`;
        if (range) head += `Content-Range: bytes ${start}-${last}/${size}\r\n`;
        if (start) handle.offset = start;
      } else {
        // Unknown size: stream until EOF, delimited by closing the connection (no seeking possible).
        console.warn(`[host] audio: size of ${track.uri} unknown; streaming without Content-Length`);
        left = Number.POSITIVE_INFINITY;
        head = `HTTP/1.1 200 OK\r\nContent-Type: ${type}\r\nAccept-Ranges: none\r\nConnection: close\r\n`;
      }
      await write(socket, head + '\r\n');
      while (left > 0 && !this.stopped) {
        const bytes = await handle.readBytes(Math.min(CHUNK, left));
        if (!bytes.length) break;
        await write(socket, Buffer.from(bytes));
        left -= bytes.length;
      }
    } finally {
      try {
        handle.close();
      } catch {}
      socket.destroy();
    }
  }
}

/** Streams an upload body straight into a cache file, chunk by chunk, with back-pressure. */
class UploadSink {
  readonly file: File;
  readonly name: string;
  readonly mimeType: string;
  readonly addedBy: string;
  readonly durationMs: number;
  readonly length: number;
  error: unknown = null;
  finished = false;
  private handle: FileHandle;
  private received = 0;
  private queued = 0;
  private paused = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private socket: Socket,
    info: { name: string; mimeType: string; addedBy: string; durationMs: number; length: number },
    uniq: string,
    private onDone: (sink: UploadSink) => void,
  ) {
    this.name = info.name;
    this.mimeType = info.mimeType;
    this.addedBy = info.addedBy;
    this.durationMs = info.durationMs;
    this.length = info.length;
    const dir = new Directory(Paths.cache, 'huddle-uploads');
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const safe = info.name.replace(/[^\w.\- ()]+/g, '_').slice(-80);
    this.file = new File(dir, `${uniq}-${safe}`);
    this.file.create({ overwrite: true });
    this.handle = this.file.open(FileMode.WriteOnly);
  }

  push(buf: Buffer) {
    if (this.finished) return;
    const take = Math.min(buf.length, this.length - this.received);
    if (take <= 0) return;
    // Copy into a plain Uint8Array for the native module (Buffer may be a view on a larger pool).
    const bytes = new Uint8Array(buf.subarray(0, take));
    this.received += take;
    this.queued++;
    if (this.queued >= UPLOAD_HIGH_WATER && !this.paused) {
      this.paused = true;
      this.socket.pause();
    }
    this.chain = this.chain
      .then(() => (this.error ? undefined : this.handle.writeBytes(bytes)))
      .catch((e) => {
        this.error ??= e;
      })
      .finally(() => {
        this.queued--;
        if (this.paused && this.queued <= 2) {
          this.paused = false;
          this.socket.resume();
        }
      });
    if (this.received >= this.length) {
      this.finished = true;
      this.chain.then(() => {
        this.closeHandle();
        if (this.paused) this.socket.resume();
        this.onDone(this);
      });
    }
  }

  abort() {
    this.finished = true;
    this.chain.then(() => {
      this.closeHandle();
      this.deleteFile();
    });
  }

  deleteFile() {
    try {
      if (this.file.exists) this.file.delete();
    } catch {}
  }

  private closeHandle() {
    try {
      this.handle.close();
    } catch {}
  }
}
