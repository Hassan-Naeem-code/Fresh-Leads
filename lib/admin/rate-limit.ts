// Lightweight in-memory login throttle for the admin login. Keyed by IP+email:
// after MAX_FAILS failed attempts inside WINDOW_MS, that key is locked for LOCK_MS.
// A successful login clears the key.
//
// NOTE: state is per server instance (resets on cold start / not shared across
// serverless instances). It meaningfully slows brute force without extra infra;
// for a stricter cross-instance guarantee, back this with the DB or Redis.

type Bucket = { fails: number; firstAt: number; lockedUntil: number };

const buckets = new Map<string, Bucket>();
const MAX_FAILS = 5;
const WINDOW_MS = 10 * 60 * 1000; // count fails within a 10-minute window
const LOCK_MS = 15 * 60 * 1000; // lock for 15 minutes once the threshold is hit
const MAX_KEYS = 5000; // safety cap so the map can't grow unbounded

function sweep(now: number) {
  if (buckets.size < MAX_KEYS) return;
  for (const [k, b] of buckets) {
    if (b.lockedUntil < now && now - b.firstAt > WINDOW_MS) buckets.delete(k);
  }
}

export function checkRateLimit(key: string): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (b && b.lockedUntil > now) {
    return { ok: false, retryAfterSec: Math.ceil((b.lockedUntil - now) / 1000) };
  }
  return { ok: true };
}

export function recordFailure(key: string): void {
  const now = Date.now();
  sweep(now);
  let b = buckets.get(key);
  if (!b || now - b.firstAt > WINDOW_MS) b = { fails: 0, firstAt: now, lockedUntil: 0 };
  b.fails += 1;
  if (b.fails >= MAX_FAILS) {
    b.lockedUntil = now + LOCK_MS;
    b.fails = 0;
    b.firstAt = now;
  }
  buckets.set(key, b);
}

export function recordSuccess(key: string): void {
  buckets.delete(key);
}
