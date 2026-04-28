import { createHash } from "node:crypto";
import {
  getCacheMaxEntries,
  getCacheTtlMs,
  getConfiguredApiKey,
} from "../config.js";

type CacheEntry = {
  value: unknown;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();

function cacheNamespace(): string {
  const apiKey = getConfiguredApiKey();
  if (!apiKey) {
    return "no-api-key";
  }

  return createHash("sha256").update(apiKey).digest("base64url").slice(0, 24);
}

function scopedKey(key: string): string {
  return `${cacheNamespace()}|${key}`;
}

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
  const namespacedKey = scopedKey(key);
  const entry = cache.get(namespacedKey);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt <= Date.now()) {
    cache.delete(namespacedKey);
    return undefined;
  }
  return entry.value;
}

export function setCachedValue(key: string, value: unknown): void {
  const now = Date.now();
  cache.set(scopedKey(key), {
    value,
    expiresAt: now + getCacheTtlMs(),
  });
  evictExpired(now);
  evictOverflow();
}

export function clearToolCacheForTests(): void {
  cache.clear();
}
