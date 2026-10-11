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
const pending = new Map<string, Promise<unknown>>();

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

function setCacheEntry(namespacedKey: string, value: unknown): void {
  const now = Date.now();
  cache.set(namespacedKey, {
    value,
    expiresAt: now + getCacheTtlMs(),
  });
  evictExpired(now);
  evictOverflow();
}

export function setCachedValue(key: string, value: unknown): void {
  setCacheEntry(scopedKey(key), value);
}

export async function getCachedOrFetchValue(
  key: string,
  fetchValue: () => Promise<unknown>,
  forceRefresh = false
): Promise<unknown> {
  const namespacedKey = scopedKey(key);
  if (!forceRefresh) {
    const cached = getCachedValue(key);
    if (cached !== undefined) {
      return cached;
    }
    const existing = pending.get(namespacedKey);
    if (existing) {
      return existing;
    }
  }

  const request = fetchValue();
  pending.set(namespacedKey, request);
  try {
    const value = await request;
    // Only the latest request may update the cache after a forced refresh.
    if (pending.get(namespacedKey) === request) {
      setCacheEntry(namespacedKey, value);
    }
    return value;
  } finally {
    if (pending.get(namespacedKey) === request) {
      pending.delete(namespacedKey);
    }
  }
}

export function clearToolCacheForTests(): void {
  cache.clear();
  pending.clear();
}
