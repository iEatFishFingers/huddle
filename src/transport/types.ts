import { ClientMsg, ServerMsg } from '../protocol';

export interface Transport {
  connect(): void;
  disconnect(): void;
  send(msg: ClientMsg): void;
  onMessage(fn: (msg: ServerMsg) => void): void;
  onStatus(fn: (connected: boolean) => void): void;
}
