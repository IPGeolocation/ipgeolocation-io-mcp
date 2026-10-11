import {
  getConfiguredApiKey,
  getRequestTimeoutMs,
} from "./config.js";
import { redactSensitiveText } from "./redaction.js";
import { isIP } from "node:net";

const API_BASE = "https://api.ipgeolocation.io";
const MAX_UPSTREAM_ERROR_CHARS = 4000;
const UPSTREAM_ERROR_MESSAGE_KEYS = [
  "message",
  "error",
  "detail",
  "description",
];

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
    public code?: "redirect_blocked"
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function fetchJsonWithTimeout(
  url: string,
  options: RequestInit = {},
  errorFallback?: string
): Promise<unknown> {
  const timeoutMs = getRequestTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, redirect: "manual", signal: controller.signal });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new ApiError(502, "502: Upstream API returned an unexpected redirect. Redirects are blocked to protect credentials and request data.", "mcp_server", "redirect_blocked");
    }
    if (!response.ok) {
      await throwUpstreamResponseError(response, errorFallback);
    }

    try {
      return await response.json();
    } catch (error) {
      if (controller.signal.aborted) {
        throw error;
      }
      throw new ApiError(502, "502: Upstream API returned invalid JSON", "mcp_server");
    }
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new ApiError(
        504,
        `504: Upstream request timed out after ${timeoutMs}ms`,
        "mcp_server"
      );
    }

    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(
      502,
      `502: Failed to reach upstream API (${redactSensitiveText(
        error instanceof Error ? error.message : String(error)
      )})`,
      "mcp_server"
    );
  } finally {
    clearTimeout(timeout);
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
    const text = await response.text();
    message = parseUpstreamErrorMessage(text, fallback);
  } catch {
    message = fallback;
  }

  message = redactSensitiveText(message);

  if (message.length > MAX_UPSTREAM_ERROR_CHARS) {
    message = `${message.slice(
      0,
      MAX_UPSTREAM_ERROR_CHARS
    )}... [truncated upstream error body]`;
  }

  throw new ApiError(response.status, `${response.status}: ${message}`);
}

async function request(
  path: string,
  params: Record<string, string | undefined> = {},
  options: { method?: string; body?: unknown; skipAuth?: boolean } = {}
): Promise<unknown> {
  const url = new URL(path, API_BASE);

  for (const [key, value] of Object.entries(params)) {
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
    fetchOptions.body = JSON.stringify(options.body);
  }

  return fetchJsonWithTimeout(url.toString(), fetchOptions);
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
    throw new ApiError(502, "502: Upstream API returned an invalid getip response: expected an IPv4 or IPv6 address.", "mcp_server");
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
