// Friendly, user-facing strings for discovery problems, and the mapping from library states/errors.
// Pure: no native imports.

export const JOIN_MESSAGES = {
  poweredOff: 'Turn on Bluetooth to find sessions nearby',
  unauthorized: 'Allow Bluetooth access in Settings to find sessions nearby',
  unsupported: "This device can't look for sessions over Bluetooth — enter the host's address instead",
  locationOff: 'Turn on Location to find sessions nearby (older Android phones need it for Bluetooth)',
  failed: "Couldn't look for sessions nearby — pull to try again, or enter the host's address",
} as const;

export const HOST_MESSAGES = {
  poweredOff: 'Turn on Bluetooth so friends nearby can find your session',
  unauthorized: 'Allow Bluetooth access in Settings so friends nearby can find your session',
  unsupported: "This device can't host over Bluetooth — friends can still join with the address shown",
  failed: "Couldn't show this session to phones nearby — friends can still join with the address shown",
} as const;

type Messages = typeof JOIN_MESSAGES | typeof HOST_MESSAGES;

/** BleState -> message; null for states that are fine or transient (poweredOn, unknown, resetting). */
export function messageForState(state: string, messages: Messages): string | null {
  switch (state) {
    case 'poweredOff':
      return messages.poweredOff;
    case 'unauthorized':
      return messages.unauthorized;
    case 'unsupported':
      return messages.unsupported;
    default:
      return null;
  }
}

/** BleError code -> message. Unknown codes get the generic failure text. */
export function messageForErrorCode(code: string | undefined, messages: Messages): string {
  switch (code) {
    case 'BLUETOOTH_POWERED_OFF':
      return messages.poweredOff;
    case 'BLUETOOTH_UNAUTHORIZED':
    case 'PERMISSION_DENIED':
      return messages.unauthorized;
    case 'BLUETOOTH_UNSUPPORTED':
    case 'NOT_SUPPORTED':
    case 'MISCONFIGURED':
      return messages.unsupported;
    default:
      return messages.failed;
  }
}

export function errorCode(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && typeof (e as { code?: unknown }).code === 'string'
    ? (e as { code: string }).code
    : undefined;
}

export function describeError(e: unknown): string {
  const code = errorCode(e);
  const message = e instanceof Error ? e.message : String(e);
  return code ? `${code}: ${message}` : message;
}
