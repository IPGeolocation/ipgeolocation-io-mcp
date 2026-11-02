import {
  getConfiguredApiKey,
  getRequestTimeoutMs,
  getRequestSignal,
  getMaxUpstreamBytes,
} from "./config.js";
import { redactSensitiveText } from "./redaction.js";
import { isIP } from "node:net";
import { AsyncLocalStorage } from "node:async_hooks";
import { RequestCancelledError, ResourceLimitError } from "./errors.js";
import { normalizeLookupArguments, validateToolArgumentSize } from "./tools/validation.js";

const API_BASE = "https://api.ipgeolocation.io";
const MAX_UPSTREAM_ERROR_CHARS = 4000;
const UPSTREAM_ERROR_MESSAGE_KEYS = [
  "message",
  "error",
  "detail",
  "description",
];
const validatedToolArguments = new AsyncLocalStorage<boolean>();

// The MCP dispatcher has already measured the original arguments before this
// context begins. Derived API parameters must not impose a second, smaller budget.
export function withValidatedToolArguments<T>(callback: () => T): T {
  return validatedToolArguments.run(true, callback);
}

export function getApiKey(): string {
  const apiKey = getConfiguredApiKey();
  if (!apiKey) {
    throw new Error(
      "API key not configured. Set the IPGEOLOCATION_API_KEY environment variable."
    );
  }
  return apiKey;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public source: "ipgeolocation_api" | "mcp_server" = "ipgeolocation_api",
    public code?: "redirect_blocked" | "invalid_response"
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function invalidResponse(message: string): ApiError {
  return new ApiError(502, `502: Upstream API ${message}. The API may already have processed the request; no automatic retry was made.`, "mcp_server", "invalid_response");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateResponse(value: unknown, expectedItems?: number): void {
  if (expectedItems === undefined) {
    if (!isRecord(value)) throw invalidResponse("returned an invalid response: expected a JSON object");
  } else {
    if (!Array.isArray(value)) throw invalidResponse("returned an invalid bulk response: expected a JSON array");
    if (value.length !== expectedItems) throw invalidResponse(`bulk item count (${value.length}) does not match input count (${expectedItems})`);
    const invalidIndex = value.findIndex(item => !isRecord(item));
    if (invalidIndex !== -1) throw invalidResponse(`bulk item at input index ${invalidIndex} is not a JSON object`);
  }
  const stack = [{ value, depth: 1 }];
  while (stack.length) {
    const current = stack.pop()!;
    if (current.depth > 64) throw invalidResponse("response exceeds the supported JSON nesting depth of 64");
    for (const child of Object.values(current.value as object)) {
      if (typeof child === "number" && !Number.isFinite(child)) throw invalidResponse("returned a non-finite JSON number");
      if (typeof child === "object" && child !== null) stack.push({ value: child, depth: current.depth + 1 });
    }
  }
}

async function readBoundedBody(response: Response, limit: number): Promise<Uint8Array | undefined> {
  const encoding = response.headers.get("content-encoding");
  const length = response.headers.get("content-length");
  if ((!encoding || encoding === "identity") && length && /^\d+$/.test(length) && Number(length) > limit) {
    void response.body?.cancel().catch(() => {});
    return undefined;
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        void reader.cancel().catch(() => {});
        return undefined;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function upstreamSizeAdvice(url: string, expectedItems?: number): string {
  const request = new URL(url);
  if (expectedItems !== undefined) {
    return request.pathname === "/v3/user-agent-bulk"
      ? "Use a smaller input batch."
      : "Use a smaller input batch or narrower upstream fields/excludes.";
  }
  if (request.pathname === "/v3/asn") {
    return request.searchParams.get("include")
      ? "Reduce optional include datasets, including datasets inferred from fields. Local excludes alone do not shrink this ASN download."
      : "This ASN request has no optional include datasets; its local fields/excludes cannot shrink the upstream download.";
  }
  if (request.pathname === "/v3/security" || request.pathname === "/v3/abuse") {
    if (request.searchParams.has("fields") || request.searchParams.has("excludes")) return "Narrow the upstream fields/excludes.";
    const module = request.pathname.slice(4);
    return `This request downloads the complete ${module} response before local projection. Changing only local fields/excludes will not shrink it. lookup_ip with targeted ${module} fields sends those fields upstream.`;
  }
  if (request.pathname === "/v3/ipgeo") {
    return request.searchParams.has("include") || request.searchParams.has("fields") || request.searchParams.has("excludes")
      ? "Narrow upstream fields/excludes or reduce include datasets."
      : "This request downloads the full core IP response before local projection; changing only local fields/excludes will not shrink this download.";
  }
  if (request.pathname === "/v3/astronomy/timeSeries") return "Use a shorter date range.";
  return "This request has no upstream response-size selectors in this server.";
}

async function fetchJsonWithTimeout(
  url: string,
  options: RequestInit = {},
  errorFallback?: string,
  expectedItems?: number
): Promise<unknown> {
  const timeoutMs = getRequestTimeoutMs();
  const controller = new AbortController();
  const requestSignal = getRequestSignal();
  const signal = requestSignal ? AbortSignal.any([requestSignal, controller.signal]) : controller.signal;
  if (signal.aborted) throw new RequestCancelledError();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, redirect: "manual", signal });
    if (response.status >= 300 && response.status < 400) {
      void response.body?.cancel().catch(() => {});
      throw new ApiError(502, "502: Upstream API returned an unexpected redirect. Redirects are blocked to protect credentials and request data.", "mcp_server", "redirect_blocked");
    }
    if (!response.ok) await throwUpstreamResponseError(response, errorFallback);
    const limit = getMaxUpstreamBytes();
    const bytes = await readBoundedBody(response, limit);
    if (!bytes) throw new ResourceLimitError(`Upstream response exceeds the ${limit}-byte limit. ${upstreamSizeAdvice(url, expectedItems)} Raise IPGEOLOCATION_UPSTREAM_MAX_RESPONSE_BYTES only with sufficient memory. The API may already have used credits; no automatic retry was made.`);
    let data: unknown;
    try { data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw invalidResponse("returned invalid JSON or UTF-8"); }
    validateResponse(data, expectedItems);
    return data;
  } catch (error) {
    // Explicit cancellation wins; a body-read deadline cannot erase received HTTP status.
    if (requestSignal?.aborted) throw new RequestCancelledError();
    if (error instanceof ApiError && error.source === "ipgeolocation_api") throw error;
    if (signal.aborted) {
      throw new ApiError(504, `504: Upstream request timed out after ${timeoutMs}ms`, "mcp_server");
    }
    if (error instanceof ApiError || error instanceof ResourceLimitError || error instanceof RequestCancelledError) throw error;
    throw new ApiError(502, `502: Upstream request or response failed (${redactSensitiveText(error instanceof Error ? error.message : String(error))}). The API may already have processed the request; no automatic retry was made.`, "mcp_server");
  } finally {
    clearTimeout(timeout);
    // Release rejected or unfinished response bodies even on older fetch runtimes.
    controller.abort();
  }
}

function parseUpstreamErrorMessage(text: string, fallback: string): string {
  if (!text) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === "string") {
      return parsed;
    }

    if (typeof parsed === "object" && parsed !== null) {
      for (const key of UPSTREAM_ERROR_MESSAGE_KEYS) {
        const value = Object.getOwnPropertyDescriptor(parsed, key)?.value;
        if (typeof value === "string" && value.trim()) {
          return value;
        }
      }
    }
  } catch {
    // Keep the raw body below when the upstream error is not JSON.
  }

  return text;
}

async function throwUpstreamResponseError(
  response: Response,
  fallback = response.statusText
): Promise<never> {
  let message: string;
  try {
    const bytes = await readBoundedBody(response, 64 * 1024);
    message = bytes ? parseUpstreamErrorMessage(new TextDecoder().decode(bytes), fallback)
      : "Upstream error body exceeded the 65536-byte limit and was omitted. Check the HTTP status; no automatic retry was made.";
  } catch {
    message = "Upstream error body was unavailable; the received HTTP status is preserved. No automatic retry was made.";
  }

  message = redactSensitiveText(message);

  if (message.length > MAX_UPSTREAM_ERROR_CHARS) {
    let end = MAX_UPSTREAM_ERROR_CHARS;
    if (/[\uD800-\uDBFF]/.test(message[end - 1]) && /[\uDC00-\uDFFF]/.test(message[end])) end--;
    message = `${message.slice(0, end)}... [truncated upstream error body]`;
  }

  throw new ApiError(response.status, `${response.status}: ${message}`);
}

async function request(
  path: string,
  params: Record<string, string | undefined> = {},
  options: { method?: string; body?: Record<string, unknown>; skipAuth?: boolean } = {}
): Promise<unknown> {
  if (!validatedToolArguments.getStore()) validateToolArgumentSize({ ...params, ...options.body });
  const url = new URL(path, API_BASE);

  for (const [key, value] of Object.entries(normalizeLookupArguments(params))) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, value);
    }
  }

  const headers = new Headers({
    Accept: "application/json",
  });

  if (!options.skipAuth) {
    headers.set("x-ipgeolocation-api-key", getApiKey());
  }

  const fetchOptions: RequestInit = {
    method: options.method || "GET",
    headers,
  };

  if (options.body) {
    headers.set("Content-Type", "application/json");
    const body = normalizeLookupArguments(options.body);
    fetchOptions.body = JSON.stringify(body);
  }

  const body = options.body as { ips?: unknown[]; uaStrings?: unknown[] } | undefined;
  const expectedItems = body?.ips?.length ?? body?.uaStrings?.length;
  return fetchJsonWithTimeout(url.toString(), fetchOptions, undefined, expectedItems);
}

export async function getIpGeolocation(params: {
  ip?: string;
  lang?: string;
  include?: string;
  fields?: string;
  excludes?: string;
}): Promise<unknown> {
  return request("/v3/ipgeo", {
    ip: params.ip,
    lang: params.lang,
    include: params.include,
    fields: params.fields,
    excludes: params.excludes,
  });
}

export async function getMyIp(): Promise<string> {
  const data = await fetchJsonWithTimeout(
    `${API_BASE}/v3/getip`,
    {},
    "Failed to retrieve IP address"
  );
  if (typeof data !== "object" || data === null || !("ip" in data) || typeof data.ip !== "string" || isIP(data.ip) === 0) {
    throw invalidResponse("returned an invalid getip response: expected an IPv4 or IPv6 address");
  }
  return data.ip;
}

export async function getSecurity(params: {
  ip?: string;
  fields?: string;
  excludes?: string;
}): Promise<unknown> {
  return request("/v3/security", {
    ip: params.ip,
    fields: params.fields,
    excludes: params.excludes,
  });
}

export async function getSecurityBulk(params: {
  ips: string[];
  fields?: string;
  excludes?: string;
}): Promise<unknown> {
  return request(
    "/v3/security-bulk",
    {
      fields: params.fields,
      excludes: params.excludes,
    },
    { method: "POST", body: { ips: params.ips } }
  );
}

export async function getTimezone(params: {
  tz?: string;
  lat?: string;
  long?: string;
  location?: string;
  ip?: string;
  iata_code?: string;
  icao_code?: string;
  lo_code?: string;
  lang?: string;
}): Promise<unknown> {
  return request("/v3/timezone", {
    tz: params.tz,
    lat: params.lat,
    long: params.long,
    location: params.location,
    ip: params.ip,
    iata_code: params.iata_code,
    icao_code: params.icao_code,
    lo_code: params.lo_code,
    lang: params.lang,
  });
}

export async function convertTimezone(params: {
  time?: string;
  tz_from?: string;
  tz_to?: string;
  lat_from?: string;
  long_from?: string;
  lat_to?: string;
  long_to?: string;
  location_from?: string;
  location_to?: string;
  iata_from?: string;
  iata_to?: string;
  icao_from?: string;
  icao_to?: string;
  locode_from?: string;
  locode_to?: string;
}): Promise<unknown> {
  return request("/v3/timezone/convert", {
    time: params.time,
    tz_from: params.tz_from,
    tz_to: params.tz_to,
    lat_from: params.lat_from,
    long_from: params.long_from,
    lat_to: params.lat_to,
    long_to: params.long_to,
    location_from: params.location_from,
    location_to: params.location_to,
    iata_from: params.iata_from,
    iata_to: params.iata_to,
    icao_from: params.icao_from,
    icao_to: params.icao_to,
    locode_from: params.locode_from,
    locode_to: params.locode_to,
  });
}

export async function getAstronomy(params: {
  lat?: string;
  long?: string;
  location?: string;
  ip?: string;
  date?: string;
  elevation?: string;
  time_zone?: string;
  lang?: string;
}): Promise<unknown> {
  return request("/v3/astronomy", {
    lat: params.lat,
    long: params.long,
    location: params.location,
    ip: params.ip,
    date: params.date,
    elevation: params.elevation,
    time_zone: params.time_zone,
    lang: params.lang,
  });
}

export async function getAsn(params: {
  asn?: string;
  ip?: string;
  include?: string;
  fields?: string;
  excludes?: string;
}): Promise<unknown> {
  return request("/v3/asn", {
    asn: params.asn,
    ip: params.ip,
    include: params.include,
    fields: params.fields,
    excludes: params.excludes,
  });
}

export async function getIpGeolocationBulk(params: {
  ips: string[];
  lang?: string;
  include?: string;
  fields?: string;
  excludes?: string;
}): Promise<unknown> {
  return request(
    "/v3/ipgeo-bulk",
    {
      lang: params.lang,
      include: params.include,
      fields: params.fields,
      excludes: params.excludes,
    },
    { method: "POST", body: { ips: params.ips } }
  );
}

export async function getAbuseContact(params: {
  ip?: string;
  fields?: string;
  excludes?: string;
}): Promise<unknown> {
  return request("/v3/abuse", {
    ip: params.ip,
    fields: params.fields,
    excludes: params.excludes,
  });
}

export async function parseUserAgent(params: {
  uaString: string;
}): Promise<unknown> {
  return request(
    "/v3/user-agent",
    {},
    { method: "POST", body: { uaString: params.uaString } }
  );
}

export async function parseUserAgentBulk(params: {
  uaStrings: string[];
}): Promise<unknown> {
  return request(
    "/v3/user-agent-bulk",
    {},
    { method: "POST", body: { uaStrings: params.uaStrings } }
  );
}

export async function getAstronomyTimeSeries(params: {
  lat?: string;
  long?: string;
  location?: string;
  ip?: string;
  dateStart: string;
  dateEnd: string;
  elevation?: string;
  time_zone?: string;
  lang?: string;
}): Promise<unknown> {
  return request("/v3/astronomy/timeSeries", {
    lat: params.lat,
    long: params.long,
    location: params.location,
    ip: params.ip,
    dateStart: params.dateStart,
    dateEnd: params.dateEnd,
    elevation: params.elevation,
    time_zone: params.time_zone,
    lang: params.lang,
  });
}
