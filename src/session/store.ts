// Tiny module-level store for things that can't travel through route params:
// the user's display name and the live Transport for the current session.
import { useSyncExternalStore } from 'react';
import type { LoopbackTransport } from '../transport/LoopbackTransport';
import type { Transport } from '../transport/types';

export type ActiveSession = (
  | { role: 'host'; transport: LoopbackTransport }
  | { role: 'joiner'; transport: Transport }
) & {
  /** Name the host chose (joiners learn the real one from the server). */
  sessionName: string;
};

type State = {
  displayName: string;
  active: ActiveSession | null;
};

let state: State = { displayName: 'Guest', active: null };
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const sessionStore = {
  get: () => state,
  subscribe,
  setDisplayName(name: string) {
    set({ displayName: name });
  },
  /** The name to show others (never empty). */
  effectiveName() {
    return state.displayName.trim() || 'Guest';
  },
  start(active: ActiveSession) {
    set({ active });
  },
  /** Clears the active session, but only if it's still `transport` (avoids racing a newer one). */
  clear(transport?: Transport) {
    if (transport && state.active?.transport !== transport) return;
    set({ active: null });
  },
};

export function useSessionStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => select(state), () => select(state));
}
