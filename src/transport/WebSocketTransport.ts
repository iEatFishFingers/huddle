import { HOST_PORT } from '../protocol';
import { Transport } from './types';

export class WebSocketTransport implements Transport {
  private ws?: WebSocket;
  private messageFn?: Parameters<Transport['onMessage']>[0];
  private statusFn?: Parameters<Transport['onStatus']>[0];

  constructor(readonly host: string, readonly port = HOST_PORT) {}

  onMessage(fn: Parameters<Transport['onMessage']>[0]) {
    this.messageFn = fn;
  }

  onStatus(fn: Parameters<Transport['onStatus']>[0]) {
    this.statusFn = fn;
  }

  connect() {
    this.ws = new WebSocket(`ws://${this.host}:${this.port}/ws`);
    this.ws.onopen = () => this.statusFn?.(true);
    this.ws.onclose = () => this.statusFn?.(false);
    this.ws.onmessage = (e) => this.messageFn?.(JSON.parse(String(e.data)));
  }

  disconnect() {
    this.ws?.close();
  }

  send(msg: Parameters<Transport['send']>[0]) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }
}
