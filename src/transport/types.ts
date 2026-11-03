import { ClientMsg, ServerMsg } from '../protocol';

/** A song file picked on this device (e.g. from expo-document-picker). */
export type PickedFile = {
  uri: string;
  name: string;
  size: number;
  mimeType: string;
  /** 0 if unknown */
  durationMs: number;
};

export interface Transport {
  connect(): void;
  disconnect(): void;
  send(msg: ClientMsg): void;
  onMessage(fn: (msg: ServerMsg) => void): void;
  onStatus(fn: (connected: boolean) => void): void;
  /**
   * Add songs from this device to the session library and the end of the queue.
   * Host: registers the local files directly. Joiner: uploads each file to the host
   * (see UPLOAD_PATH in protocol.ts). `onProgress` gets 0..1 across all files.
   */
  addFiles(files: PickedFile[], addedBy: string, onProgress?: (fraction: number) => void): Promise<void>;
  /**
   * The connection ended for good and won't be retried (host ended the session, session full,
   * host unreachable). `message` is user-facing. Optional: the host's loopback never ends this way.
   */
  onError?(fn: (message: string) => void): void;
}
