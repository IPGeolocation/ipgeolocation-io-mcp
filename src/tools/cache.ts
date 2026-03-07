const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_CACHE_ENTRIES = 500;

type CacheEntry = {
  value: unknown;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();

function parseIntEnv(
  name: string,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return fallback;
  }

  return parsed;
}

function ttlMs(): number {
  return parseIntEnv("IPGEOLOCATION_MCP_CACHE_TTL_MS", DEFAULT_CACHE_TTL_MS, 1000, 3600000);
}

function maxEntries(): number {
  return parseIntEnv("IPGEOLOCATION_MCP_CACHE_MAX_ENTRIES", DEFAULT_MAX_CACHE_ENTRIES, 10, 5000);
}

function evictExpired(now = Date.now()): void {
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
}

function evictOverflow(): void {
  const limit = maxEntries();
  while (cache.size > limit) {
    const firstKey = cache.keys().next().value as string | undefined;
    if (!firstKey) {
      break;
    }
    cache.delete(firstKey);
  }
}

export function getCachedValue(key: string): unknown | undefined {
  evictExpired();
  const entry = cache.get(key);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

export function setCachedValue(key: string, value: unknown): void {
  const now = Date.now();
  cache.set(key, {
    value,
    expiresAt: now + ttlMs(),
  });
  evictExpired(now);
  evictOverflow();
}

export function clearToolCacheForTests(): void {
  cache.clear();
}
