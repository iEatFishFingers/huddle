// Pure HTTP/1.1 helpers for PeerServer. No React Native imports, so they can be exercised from
// Node (see scripts/test-http.ts).
import { Buffer } from 'buffer';

export const MAX_HEAD_BYTES = 16 * 1024;

export type RequestHead = {
  method: string;
  /** Raw request target, e.g. `/upload?name=a.mp3` */
  target: string;
  /** Decoded path without the query string, e.g. `/upload` */
  path: string;
  query: Record<string, string>;
  /** Lower-cased header names. */
  headers: Record<string, string>;
  /** Bytes that arrived after the blank line (start of the body / first WebSocket frames). */
  rest: Buffer;
};

/**
 * Parse the request line + headers out of `buf`.
 * Returns null if the head isn't complete yet, 'too-large' if it never will be.
 */
export function parseRequestHead(buf: Buffer): RequestHead | null | 'too-large' {
  const end = buf.indexOf('\r\n\r\n');
  if (end < 0) return buf.length > MAX_HEAD_BYTES ? 'too-large' : null;
  if (end > MAX_HEAD_BYTES) return 'too-large';
  const lines = buf.toString('latin1', 0, end).split('\r\n');
  const [method = '', target = ''] = lines[0].split(' ');
  const headers: Record<string, string> = {};
  for (const l of lines.slice(1)) {
    const i = l.indexOf(':');
    if (i > 0) headers[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
  }
  const q = target.indexOf('?');
  let path = q < 0 ? target : target.slice(0, q);
  try {
    path = decodeURIComponent(path);
  } catch {}
  return {
    method: method.toUpperCase(),
    target,
    path,
    query: parseQuery(q < 0 ? '' : target.slice(q + 1)),
    headers,
    rest: Buffer.from(buf.subarray(end + 4)),
  };
}

export function parseQuery(qs: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of qs.split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    const k = i < 0 ? part : part.slice(0, i);
    const v = i < 0 ? '' : part.slice(i + 1);
    const dec = (s: string) => {
      try {
        return decodeURIComponent(s.replace(/\+/g, ' '));
      } catch {
        return s;
      }
    };
    out[dec(k)] = dec(v);
  }
  return out;
}

export type ByteRange = { start: number; end: number /* inclusive */ };

/**
 * Parse a `Range: bytes=...` header against a file of `size` bytes (first range only).
 * null = no/ignored range (serve the whole file), 'unsatisfiable' = reply 416.
 */
export function parseRange(header: string | undefined, size: number): ByteRange | null | 'unsatisfiable' {
  if (!header) return null;
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)/i.exec(header);
  if (!m || (!m[1] && !m[2])) return null;
  if (!m[1]) {
    // suffix range: last N bytes
    const n = Number(m[2]);
    if (n === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  if (start >= size) return 'unsatisfiable';
  const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (end < start) return null; // malformed: ignore, per RFC 9110
  return { start, end };
}

export type UploadCheck =
  | { ok: true; length: number; name: string; addedBy: string; mimeType: string; durationMs: number }
  | { ok: false; status: number; reason: string };

/** Validate a POST /upload request head against the size cap. */
export function checkUpload(head: RequestHead, maxBytes: number): UploadCheck {
  const name = (head.query.name ?? '').replace(/[\/\\]/g, '_').trim();
  if (!name) return { ok: false, status: 400, reason: 'missing ?name=' };
  if (head.headers['transfer-encoding'] && !head.headers['content-length'])
    return { ok: false, status: 411, reason: 'chunked uploads are not supported; send Content-Length' };
  const raw = head.headers['content-length'];
  if (raw === undefined || !/^\d+$/.test(raw)) return { ok: false, status: 411, reason: 'Content-Length required' };
  const length = Number(raw);
  if (length > maxBytes)
    return { ok: false, status: 413, reason: `file is ${Math.round(length / 1048576)} MB; the limit is ${Math.round(maxBytes / 1048576)} MB` };
  if (length === 0) return { ok: false, status: 400, reason: 'empty file' };
  const dur = Number(head.headers['x-huddle-duration-ms'] ?? 0);
  return {
    ok: true,
    length,
    name,
    addedBy: (head.query.addedBy ?? '').trim() || 'Someone',
    mimeType: head.headers['content-type'] || mimeForName(name),
    durationMs: Number.isFinite(dur) && dur > 0 ? Math.round(dur) : 0,
  };
}

const MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  caf: 'audio/x-caf',
  webm: 'audio/webm',
};

/** Best-guess audio MIME type from a file name or URI (ignores query strings). */
export function mimeForName(name: string): string {
  const ext = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(name)?.[1]?.toLowerCase() ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}

const STATUS: Record<number, string> = {
  200: 'OK',
  206: 'Partial Content',
  400: 'Bad Request',
  404: 'Not Found',
  411: 'Length Required',
  413: 'Content Too Large',
  416: 'Range Not Satisfiable',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

/** A complete small response with `Connection: close`. */
export function simpleResponse(status: number, body = '', contentType = 'text/plain; charset=utf-8'): string {
  const len = Buffer.byteLength(body, 'utf8');
  return (
    `HTTP/1.1 ${status} ${STATUS[status] ?? ''}\r\nContent-Type: ${contentType}\r\nContent-Length: ${len}\r\n` +
    `Connection: close\r\n\r\n${body}`
  );
}
