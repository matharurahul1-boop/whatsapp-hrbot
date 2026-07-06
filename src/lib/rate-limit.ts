interface Window { tokens: number; reset: number }
import { createAdminClient } from '@/lib/supabase/admin';

// In-memory store — per serverless instance (good enough for abuse prevention;
// pairs with Meta's own signature check which blocks non-Meta requests)
const store = new Map<string, Window>();

// Clean up old entries every 1000 calls to avoid memory leak
let calls = 0;
function cleanup() {
  if (++calls % 1000 !== 0) return;
  const now = Date.now();
  for (const [key, w] of store) {
    if (w.reset < now) store.delete(key);
  }
}

/**
 * Returns true if the request is allowed, false if rate-limited.
 * @param key    - identifier (e.g. phone number, IP)
 * @param limit  - max requests per window (default 20)
 * @param window - window duration in ms (default 60 000 = 1 min)
 */
export function rateLimit(
  key:    string,
  limit  = 20,
  window = 60_000,
): boolean {
  cleanup();
  const now = Date.now();
  const rec = store.get(key);

  if (!rec || rec.reset < now) {
    store.set(key, { tokens: limit - 1, reset: now + window });
    return true;
  }

  if (rec.tokens <= 0) return false;
  rec.tokens--;
  return true;
}

export async function distributedRateLimit(key: string, limit = 20, window = 60_000): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().rpc('check_rate_limit', {
      p_key: key,
      p_limit: limit,
      p_window_seconds: Math.max(1, Math.ceil(window / 1000)),
    });
    if (!error && typeof data === 'boolean') return data;
  } catch { /* migration may not be applied yet; use local fallback */ }
  return rateLimit(key, limit, window);
}
