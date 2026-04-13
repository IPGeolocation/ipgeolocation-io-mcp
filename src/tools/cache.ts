import {
  getCacheMaxEntries,
  getCacheTtlMs,
} from "../config.js";

type CacheEntry = {
  value: unknown;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();

function evictExpired(now = Date.now()): void {
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
}

function evictOverflow(): void {
  const limit = getCacheMaxEntries();
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
    expiresAt: now + getCacheTtlMs(),
  });
  evictExpired(now);
  evictOverflow();
}

export function clearToolCacheForTests(): void {
  cache.clear();
}
