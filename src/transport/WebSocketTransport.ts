import { File, UploadType } from 'expo-file-system';
import { HOST_PORT, MAX_UPLOAD_BYTES, ServerMsg, UPLOAD_PATH } from '../protocol';
import { PickedFile, Transport } from './types';

const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 5000;
const RECONNECT_GIVE_UP_MS = 30_000;
/** Close code the host uses when the session is full; reconnecting won't help. */
const CLOSE_SESSION_FULL = 1013;

/** Accepts "192.168.1.5", "192.168.1.5:8788" or a bare host plus explicit port. */
function splitHostPort(host: string, port?: number): { host: string; port: number } {
  const m = /^\s*([^:\s]+):(\d+)\s*$/.exec(host);
  if (m && port === undefined) return { host: m[1], port: Number(m[2]) };
  return { host: host.trim(), port: port ?? HOST_PORT };
}

/** A joining phone's connection to the host over Wi-Fi, with automatic reconnect. */
export class WebSocketTransport implements Transport {
  readonly host: string;
  readonly port: number;
  private ws?: WebSocket;
  private messageFn?: Parameters<Transport['onMessage']>[0];
  private statusFn?: Parameters<Transport['onStatus']>[0];
  private errorFn?: (message: string) => void;
  private wanted = false;
  private connected = false;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private retryDelay = RECONNECT_MIN_MS;
  private droppedAt = 0;

  constructor(host: string, port?: number) {
    const hp = splitHostPort(host, port);
    this.host = hp.host;
    this.port = hp.port;
  }

  onMessage(fn: Parameters<Transport['onMessage']>[0]) {
    this.messageFn = fn;
  }

  onStatus(fn: Parameters<Transport['onStatus']>[0]) {
    this.statusFn = fn;
  }

  /** Readable reason when the connection is lost for good (session full, host gone). */
  onError(fn: (message: string) => void) {
    this.errorFn = fn;
  }

  connect() {
    this.wanted = true;
    this.droppedAt = 0;
    this.retryDelay = RECONNECT_MIN_MS;
    this.open();
  }

  disconnect() {
    this.wanted = false;
    clearTimeout(this.retryTimer);
    const ws = this.ws;
    this.ws = undefined;
    if (ws) {
      ws.onopen = ws.onclose = ws.onmessage = ws.onerror = null;
      ws.close();
    }
    if (this.connected) {
      this.connected = false;
      this.statusFn?.(false);
    }
  }

  send(msg: Parameters<Transport['send']>[0]) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  private open() {
    const ws = new WebSocket(`ws://${this.host}:${this.port}/ws`);
    this.ws = ws;
    let lastError = '';
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.droppedAt = 0;
      this.retryDelay = RECONNECT_MIN_MS;
      this.connected = true;
      this.statusFn?.(true);
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      this.messageFn?.(msg);
    };
    ws.onerror = (e: any) => {
      lastError = e?.message ?? '';
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = undefined;
      if (this.connected) {
        this.connected = false;
        this.statusFn?.(false);
      }
      if (!this.wanted) return;
      if (e.code === CLOSE_SESSION_FULL) {
        this.wanted = false;
        return this.errorFn?.('The session is full.');
      }
      const now = Date.now();
      if (!this.droppedAt) this.droppedAt = now;
      if (now - this.droppedAt >= RECONNECT_GIVE_UP_MS) {
        this.wanted = false;
        console.warn(`[join] giving up on ${this.host}:${this.port}: ${lastError || `closed (${e.code})`}`);
        return this.errorFn?.(`Lost connection to the host${lastError ? `: ${lastError}` : ''}.`);
      }
      const delay = this.retryDelay;
      this.retryDelay = Math.min(this.retryDelay * 2, RECONNECT_MAX_MS);
      this.retryTimer = setTimeout(() => this.wanted && this.open(), delay);
    };
  }

  /** Upload each picked song to the host (raw bytes, see UPLOAD_PATH in protocol.ts). */
  async addFiles(files: PickedFile[], addedBy: string, onProgress?: (fraction: number) => void): Promise<void> {
    const sizes = files.map((f) => {
      if (f.size > 0) return f.size;
      try {
        return new File(f.uri).size ?? 0;
      } catch {
        return 0;
      }
    });
    const total = sizes.reduce((a, b) => a + b, 0) || 1;
    let done = 0;
    onProgress?.(0);
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (sizes[i] > MAX_UPLOAD_BYTES) {
        throw new Error(`"${f.name}" is too big to share (${Math.round(sizes[i] / 1048576)} MB, limit ${MAX_UPLOAD_BYTES / 1048576} MB).`);
      }
      const url =
        `http://${this.host}:${this.port}${UPLOAD_PATH}` +
        `?name=${encodeURIComponent(f.name)}&addedBy=${encodeURIComponent(addedBy)}`;
      let res;
      try {
        res = await new File(f.uri).upload(url, {
          httpMethod: 'POST',
          uploadType: UploadType.BINARY_CONTENT,
          headers: {
            'Content-Type': f.mimeType || 'application/octet-stream',
            'X-Huddle-Duration-Ms': String(Math.max(0, Math.round(f.durationMs || 0))),
          },
          // Background sessions on iOS can be deferred by the system; we want it now.
          sessionType: 'foreground',
          onProgress: ({ bytesSent, totalBytes }) => {
            const size = sizes[i] || totalBytes || 0;
            onProgress?.(Math.min(1, (done + Math.min(bytesSent, size)) / total));
          },
        });
      } catch (e) {
        throw new Error(`Couldn't upload "${f.name}": ${e instanceof Error ? e.message : String(e)}`);
      }
      if (res.status !== 200) {
        let reason = res.body;
        try {
          reason = JSON.parse(res.body).error ?? reason;
        } catch {}
        throw new Error(`The host refused "${f.name}" (${res.status})${reason ? `: ${reason}` : ''}`);
      }
      done += sizes[i];
      onProgress?.(Math.min(1, done / total));
    }
    onProgress?.(1);
  }
}
