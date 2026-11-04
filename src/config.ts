import { AsyncLocalStorage } from "node:async_hooks";

const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_CACHE_ENTRIES = 500;
const DEFAULT_MAX_BULK_ITEMS = 1000;
const DEFAULT_MAX_ITEMS_IN_RESPONSE = 250;
const DEFAULT_MAX_RESPONSE_CHARS = 200000;
const DEFAULT_MAX_ERROR_CHARS = 4000;
const MIB = 1024 * 1024;
const requestSignalStorage = new AsyncLocalStorage<AbortSignal | undefined>();

export function withRequestSignal<T>(signal: AbortSignal | undefined, callback: () => T): T {
  return requestSignalStorage.run(signal, callback);
}

export function getRequestSignal(): AbortSignal | undefined {
  return requestSignalStorage.getStore();
}

export type RuntimeConfig = {
  apiKey?: string;
};

const runtimeConfigStorage = new AsyncLocalStorage<RuntimeConfig>();

function parseBoundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (!raw) {
    return fallback;
  }

  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) return fallback;
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    return fallback;
  }

  return parsed;
}

function normalizeRuntimeConfig(config: Partial<RuntimeConfig> = {}): RuntimeConfig {
  if (config.apiKey === undefined) return {};
  if (typeof config.apiKey !== "string") throw new Error("API key configuration must be a string; omit it to use the environment variable.");
  return { apiKey: config.apiKey.trim() };
}

export function withRuntimeConfig<T>(
  config: Partial<RuntimeConfig> = {},
  callback: () => T
): T {
  return runtimeConfigStorage.run(normalizeRuntimeConfig(config), callback);
}

export function getConfiguredApiKey(): string | undefined {
  return (runtimeConfigStorage.getStore()?.apiKey ?? process.env.IPGEOLOCATION_API_KEY)?.trim() || undefined;
}

export function getRequestTimeoutMs(): number {
  return parseBoundedInt(
    process.env.IPGEOLOCATION_REQUEST_TIMEOUT_MS,
    DEFAULT_REQUEST_TIMEOUT_MS,
    1000,
    120000
  );
}

export function getCacheTtlMs(): number {
  return parseBoundedInt(
    process.env.IPGEOLOCATION_MCP_CACHE_TTL_MS,
    DEFAULT_CACHE_TTL_MS,
    1000,
    3600000
  );
}

export function getCacheMaxEntries(): number {
  return parseBoundedInt(
    process.env.IPGEOLOCATION_MCP_CACHE_MAX_ENTRIES,
    DEFAULT_MAX_CACHE_ENTRIES,
    10,
    5000
  );
}

export function getMaxBulkItems(): number {
  return parseBoundedInt(
    process.env.IPGEOLOCATION_MCP_MAX_BULK_ITEMS,
    DEFAULT_MAX_BULK_ITEMS,
    1,
    50000
  );
}

export function getMaxItemsInResponse(): number {
  return parseBoundedInt(
    process.env.IPGEOLOCATION_MCP_MAX_RESULT_ITEMS,
    DEFAULT_MAX_ITEMS_IN_RESPONSE,
    1,
    50000
  );
}

export function getMaxResponseChars(): number {
  return parseBoundedInt(
    process.env.IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS,
    DEFAULT_MAX_RESPONSE_CHARS,
    10000,
    2000000
  );
}

export function getMaxErrorChars(): number {
  return parseBoundedInt(
    process.env.IPGEOLOCATION_MCP_MAX_ERROR_CHARS,
    DEFAULT_MAX_ERROR_CHARS,
    200,
    50000
  );
}

export function getCacheMaxBytes(): number {
  return parseBoundedInt(process.env.IPGEOLOCATION_MCP_CACHE_MAX_BYTES, 32 * MIB, 4 * MIB, 1024 * MIB);
}

export function getMaxUpstreamBytes(): number {
  return parseBoundedInt(process.env.IPGEOLOCATION_UPSTREAM_MAX_RESPONSE_BYTES, 8 * MIB, MIB, 256 * MIB);
}

export function getMaxToolArgumentBytes(): number {
  return parseBoundedInt(process.env.IPGEOLOCATION_MCP_MAX_ARGUMENT_BYTES, 4 * MIB, 64 * 1024, 32 * MIB);
}
