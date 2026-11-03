/**
 * Verbose diagnostics ([ble], [host], [join], [sync]): printed in development builds only, so
 * release builds don't pay for chatty logging. Use console.warn for problems that should always show.
 * (`typeof` guard: some modules also run under plain Node in tests, where __DEV__ isn't defined.)
 */
const dev = typeof __DEV__ === 'undefined' || __DEV__;

export const devLog: (...args: unknown[]) => void = dev ? console.log.bind(console) : () => {};
