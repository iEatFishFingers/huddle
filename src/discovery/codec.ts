// Session info <-> bytes for the GATT characteristic. Pure: no native imports, safe to unit-test in Node.
//
// Format: UTF-8 JSON {v:1, sessionName, hostName, host, port, members, maxMembers}. Non-ASCII
// characters are written as JSON \u escapes, so the bytes are plain ASCII (no TextEncoder needed
// on Hermes). The decoder still accepts real UTF-8.

import { MAX_NAME_LENGTH } from './constants';
import type { AdvertisedSession } from './types';

const FORMAT_VERSION = 1;
/** GATT attribute values are capped at 512 bytes. */
export const MAX_ENCODED_BYTES = 512;

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-￿]/g,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function isInt(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** Returns a cleaned copy, or null when the info can't be advertised/joined. */
export function validateSession(raw: unknown): AdvertisedSession | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.host !== 'string' || !IPV4.test(o.host.trim())) return null;
  if (!isInt(o.port, 1, 65535)) return null;
  const members = isInt(o.members, 0, 1000) ? o.members : 0;
  const maxMembers = isInt(o.maxMembers, 1, 1000) ? o.maxMembers : Math.max(members, 1);
  const hostName = typeof o.hostName === 'string' ? clip(o.hostName, MAX_NAME_LENGTH) : '';
  const sessionName =
    typeof o.sessionName === 'string' && o.sessionName.trim() !== ''
      ? clip(o.sessionName, MAX_NAME_LENGTH)
      : hostName || 'Huddle session';
  return { sessionName, hostName, host: o.host.trim(), port: o.port, members, maxMembers };
}

export function encodeSession(info: AdvertisedSession): Uint8Array {
  const clean = validateSession(info);
  if (!clean) throw new Error(`[ble] cannot advertise invalid session info: ${JSON.stringify(info)}`);
  const json = asciiJson({ v: FORMAT_VERSION, ...clean });
  const bytes = new Uint8Array(json.length);
  for (let i = 0; i < json.length; i++) bytes[i] = json.charCodeAt(i);
  if (bytes.length > MAX_ENCODED_BYTES) throw new Error('[ble] session info too large');
  return bytes;
}

/** Minimal, lenient UTF-8 decoder (invalid sequences become U+FFFD). */
export function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i++];
    let cp: number;
    if (b < 0x80) cp = b;
    else if (b >= 0xc2 && b < 0xe0 && i < bytes.length) cp = ((b & 0x1f) << 6) | (bytes[i++] & 0x3f);
    else if (b >= 0xe0 && b < 0xf0 && i + 1 < bytes.length) {
      cp = ((b & 0x0f) << 12) | ((bytes[i] & 0x3f) << 6) | (bytes[i + 1] & 0x3f);
      i += 2;
    } else if (b >= 0xf0 && b < 0xf5 && i + 2 < bytes.length) {
      cp = ((b & 0x07) << 18) | ((bytes[i] & 0x3f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
      i += 3;
    } else cp = 0xfffd;
    out += String.fromCodePoint(cp);
  }
  return out;
}

/** Bytes read from a host -> validated session info, or null (logged) when malformed. */
export function decodeSession(bytes: Uint8Array): AdvertisedSession | null {
  try {
    const parsed: unknown = JSON.parse(utf8Decode(bytes));
    if (typeof parsed === 'object' && parsed !== null && typeof (parsed as { v?: unknown }).v === 'number') {
      const v = (parsed as { v: number }).v;
      if (v > FORMAT_VERSION) console.log(`[ble] session info format v${v} is newer than v${FORMAT_VERSION}; reading what we know`);
    }
    return validateSession(parsed);
  } catch {
    return null;
  }
}
