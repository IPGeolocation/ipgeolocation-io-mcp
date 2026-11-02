import { createHash } from "node:crypto";
import {
  getCacheMaxBytes, getCacheMaxEntries, getCacheTtlMs, getConfiguredApiKey,
  getRequestSignal, withRequestSignal,
} from "../config.js";
import { RequestCancelledError } from "../errors.js";

type CacheEntry = { value: unknown; expiresAt: number; bytes: number; version: number; family?: string };
type Family = { generation: number; inFlight: number; lastSuccess: number };
type Pending = {
  promise: Promise<unknown>; controller: AbortController; users: number;
  family?: Family; generation: number;
};
const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Pending>();
const families = new Map<string, Family>();
let cachedBytes = 0;
let cacheVersion = 0;

function cacheNamespace(): string {
  const apiKey = getConfiguredApiKey();
  return apiKey ? createHash("sha256").update(apiKey).digest("base64url").slice(0, 24) : "no-api-key";
}
function scopedKey(key: string): string { return `${cacheNamespace()}|${key}`; }
function removeEntry(key: string): void {
  const entry = cache.get(key);
  if (entry) cachedBytes -= entry.bytes;
  cache.delete(key);
}
function evictExpired(now = Date.now()): void {
  for (const [key, entry] of cache) if (entry.expiresAt <= now) removeEntry(key);
}
function evictOverflow(): void {
  const entries = getCacheMaxEntries(), bytes = getCacheMaxBytes();
  while (cache.size > entries || cachedBytes > bytes) removeEntry(cache.keys().next().value!);
}
function getCacheEntry(key: string): CacheEntry | undefined {
  evictExpired();
  evictOverflow();
  const namespacedKey = scopedKey(key), entry = cache.get(namespacedKey);
  if (!entry) return undefined;
  cache.delete(namespacedKey);
  cache.set(namespacedKey, entry);
  return entry;
}
export function getCachedValue(key: string): unknown | undefined {
  return getCacheEntry(key)?.value;
}
export function touchCachedValue(key: string): number | undefined {
  const entry = getCacheEntry(key);
  if (!entry) return undefined;
  return entry.expiresAt = Date.now() + getCacheTtlMs();
}
function setCacheEntry(key: string, value: unknown, family?: string, valueBytes?: number, version?: number): boolean {
  if (valueBytes !== undefined && (!Number.isSafeInteger(valueBytes) || valueBytes < 0)) {
    throw new Error("Cached value size must be a nonnegative safe integer.");
  }
  removeEntry(key);
  if (valueBytes === undefined) {
    const json = JSON.stringify(value);
    if (json === undefined) return false;
    valueBytes = Buffer.byteLength(json);
  }
  const bytes = Buffer.byteLength(key) + valueBytes + (family ? Buffer.byteLength(family) : 0);
  if (bytes > getCacheMaxBytes()) return false;
  const now = Date.now();
  cache.set(key, { value, expiresAt: now + getCacheTtlMs(), bytes, version: version ?? ++cacheVersion, family });
  cachedBytes += bytes;
  evictExpired(now);
  evictOverflow();
  return cache.has(key);
}
export function setCachedValue(key: string, value: unknown, valueBytes?: number): boolean {
  return setCacheEntry(scopedKey(key), value, undefined, valueBytes);
}

function subscribe(key: string, entry: Pending, signal?: AbortSignal): Promise<unknown> {
  if (signal?.aborted) {
    if (entry.users === 0) { entry.controller.abort(); if (pending.get(key) === entry) pending.delete(key); }
    return Promise.reject(new RequestCancelledError());
  }
  entry.users++;
  return new Promise((resolve, reject) => {
    let active = true;
    const release = () => {
      if (!active) return;
      active = false;
      signal?.removeEventListener("abort", cancel);
      entry.users--;
    };
    const cancel = () => {
      release();
      if (entry.users === 0) {
        entry.controller.abort();
        if (pending.get(key) === entry) pending.delete(key);
      }
      reject(new RequestCancelledError());
    };
    signal?.addEventListener("abort", cancel, { once: true });
    entry.promise.then(value => { if (active) { release(); resolve(value); } },
      error => { if (active) { release(); reject(error); } });
  });
}

export async function getCachedOrFetchValue(
  key: string,
  fetchValue: () => Promise<unknown>,
  forceRefresh = false,
  shouldCache: (value: unknown) => boolean = () => true,
  family?: string
): Promise<unknown> {
  const signal = getRequestSignal();
  if (signal?.aborted) throw new RequestCancelledError();
  const namespacedKey = scopedKey(key), familyKey = family === undefined ? undefined : scopedKey(family);
  let state = familyKey === undefined ? undefined : families.get(familyKey);
  if (!forceRefresh) {
    const cached = getCachedValue(key);
    if (cached !== undefined) return cached;
    const existing = pending.get(namespacedKey);
    if (existing && !existing.controller.signal.aborted && (!existing.family || existing.generation === existing.family.generation)) {
      return subscribe(namespacedKey, existing, signal);
    }
  }
  const versionAtStart = ++cacheVersion;
  if (familyKey !== undefined) {
    if (!state) { state = { generation: 0, inFlight: 0, lastSuccess: 0 }; families.set(familyKey, state); }
    if (forceRefresh) state.generation++;
    state.inFlight++;
  }
  const entry: Pending = { promise: undefined!, controller: new AbortController(), users: 0, family: state, generation: state?.generation ?? 0 };
  pending.set(namespacedKey, entry);
  entry.promise = (async () => {
    try {
      const value = await withRequestSignal(entry.controller.signal, fetchValue);
      const active = !entry.controller.signal.aborted;
      const refresh = forceRefresh || entry.generation > 0;
      if (active && state) state.lastSuccess = Math.max(state.lastSuccess, versionAtStart);
      const latest = active && pending.get(namespacedKey) === entry && (!state || entry.generation === state.generation)
        && (!refresh || !state || state.lastSuccess === versionAtStart);
      // A superseded success still invalidates data that predates its refresh.
      if (active && refresh) {
        for (const [cachedKey, cached] of cache) {
          const related = familyKey === undefined ? cachedKey === namespacedKey : cached.family === familyKey;
          if (related && cached.version <= versionAtStart) removeEntry(cachedKey);
        }
      }
      // A superseded or abandoned request may finish, but cannot replace newer data.
      if (latest) {
        if (shouldCache(value)) setCacheEntry(namespacedKey, value, familyKey, undefined, versionAtStart);
        else removeEntry(namespacedKey);
      }
      return value;
    } finally {
      if (pending.get(namespacedKey) === entry) pending.delete(namespacedKey);
      if (state && --state.inFlight === 0 && familyKey !== undefined && families.get(familyKey) === state) families.delete(familyKey);
    }
  })();
  return subscribe(namespacedKey, entry, signal);
}

export function clearToolCacheForTests(): void {
  for (const entry of pending.values()) entry.controller.abort();
  cache.clear(); pending.clear(); families.clear(); cachedBytes = 0;
}
