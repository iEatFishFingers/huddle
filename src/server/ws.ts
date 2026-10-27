import { Buffer } from 'buffer';
import * as Crypto from 'expo-crypto';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'; // RFC 6455

/** Value for the Sec-WebSocket-Accept header. */
export async function acceptKey(clientKey: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA1, clientKey + WS_GUID, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  return digest;
}

/** Encode an unmasked server->client frame. */
export function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.from([0x80 | opcode, 126, len >> 8, len & 0xff]);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  return Buffer.concat([header, payload]);
}

export type Frame = { opcode: number; payload: Buffer };

/** Incremental parser for masked client->server frames (handles fragmentation). */
export class FrameParser {
  private buf = Buffer.alloc(0);
  private fragments: Buffer[] = [];
  private fragOpcode = 0;

  push(chunk: Buffer): Frame[] {
    this.buf = Buffer.concat([this.buf, chunk]);
    const out: Frame[] = [];
    for (;;) {
      const b = this.buf;
      if (b.length < 2) break;
      const fin = (b[0] & 0x80) !== 0;
      const opcode = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (b.length < 4) break;
        len = b.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (b.length < 10) break;
        len = b.readUInt32BE(6);
        offset = 10;
      }
      const maskLen = masked ? 4 : 0;
      if (b.length < offset + maskLen + len) break;
      const payload = Buffer.from(b.subarray(offset + maskLen, offset + maskLen + len));
      if (masked) for (let i = 0; i < len; i++) payload[i] ^= b[offset + (i & 3)];
      this.buf = Buffer.from(b.subarray(offset + maskLen + len));

      if (opcode >= 0x8) {
        out.push({ opcode, payload }); // control frames are never fragmented
      } else {
        if (opcode !== 0) this.fragOpcode = opcode;
        this.fragments.push(payload);
        if (fin) {
          out.push({ opcode: this.fragOpcode, payload: Buffer.concat(this.fragments) });
          this.fragments = [];
        }
      }
    }
    return out;
  }
}
