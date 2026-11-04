import { useEffect, useRef, useState } from 'react';

type Result<T> = { key: string; data?: T; error?: string };

/**
 * Load something from the server whenever `key` changes (null = don't load).
 * Keeps showing the previous data while a new load runs, so lists don't flash empty.
 */
export function useRemote<T>(key: string | null, load: () => Promise<T>) {
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  const [result, setResult] = useState<Result<T> | null>(null);
  const [nonce, setNonce] = useState(0);
  const fullKey = key === null ? null : `${key}#${nonce}`;

  useEffect(() => {
    if (fullKey === null) return;
    let cancelled = false;
    loadRef.current().then(
      (data) => !cancelled && setResult({ key: fullKey, data }),
      (e) => !cancelled && setResult((prev) => ({ key: fullKey, data: prev?.data, error: e instanceof Error ? e.message : String(e) })),
    );
    return () => {
      cancelled = true;
    };
  }, [fullKey]);

  return {
    data: result?.data,
    error: result && result.key === fullKey ? result.error : undefined,
    loading: fullKey !== null && result?.key !== fullKey,
    reload: () => setNonce((n) => n + 1),
  };
}
