import { AsyncLocalStorage } from "node:async_hooks";

const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_CACHE_ENTRIES = 500;
const DEFAULT_MAX_BULK_ITEMS = 1000;
const DEFAULT_MAX_ITEMS_IN_RESPONSE = 250;
const DEFAULT_MAX_RESPONSE_CHARS = 200000;
const DEFAULT_MAX_ERROR_CHARS = 4000;

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

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return fallback;
  }

  return parsed;
}

function normalizeRuntimeConfig(config: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return config.apiKey ? { apiKey: config.apiKey } : {};
}

export function withRuntimeConfig<T>(
  config: Partial<RuntimeConfig> = {},
  callback: () => T
): T {
  return runtimeConfigStorage.run(normalizeRuntimeConfig(config), callback);
}

export function getConfiguredApiKey(): string | undefined {
  return runtimeConfigStorage.getStore()?.apiKey || process.env.IPGEOLOCATION_API_KEY;
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
