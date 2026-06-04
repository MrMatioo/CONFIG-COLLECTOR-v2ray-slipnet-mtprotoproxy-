interface RateLimitEntry {
  count: number;
  firstRequest: number;
}

const rateLimitStore = new Map<number, RateLimitEntry>();
const MAX_REQUESTS = 10;
const TIME_WINDOW_MS = 60_000;

export function isRateLimited(userId: number): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(userId);
  if (!entry) {
    rateLimitStore.set(userId, { count: 1, firstRequest: now });
    return false;
  }
  if (now - entry.firstRequest > TIME_WINDOW_MS) {
    rateLimitStore.set(userId, { count: 1, firstRequest: now });
    return false;
  }
  if (entry.count >= MAX_REQUESTS) {
    return true;
  }
  entry.count++;
  rateLimitStore.set(userId, entry);
  return false;
}

setInterval(() => {
  const now = Date.now();
  for (const [userId, entry] of rateLimitStore.entries()) {
    if (now - entry.firstRequest > TIME_WINDOW_MS) {
      rateLimitStore.delete(userId);
    }
  }
}, 60_000);
