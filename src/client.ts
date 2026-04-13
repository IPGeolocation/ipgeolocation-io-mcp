import {
  getConfiguredApiKey,
  getRequestTimeoutMs,
} from "./config.js";

const API_BASE = "https://api.ipgeolocation.io";
const MAX_UPSTREAM_ERROR_CHARS = 4000;

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
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const timeoutMs = getRequestTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(
        504,
        `504: Upstream request timed out after ${timeoutMs}ms`
      );
    }

    throw new ApiError(
      502,
      `502: Failed to reach upstream API (${error instanceof Error ? error.message : String(error)})`
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function request(
  path: string,
  params: Record<string, string | undefined> = {},
  options: { method?: string; body?: unknown; skipAuth?: boolean } = {}
): Promise<unknown> {
  const url = new URL(path, API_BASE);

  if (!options.skipAuth) {
    url.searchParams.set("apiKey", getApiKey());
  }

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, value);
    }
  }

  const fetchOptions: RequestInit = {
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
    },
  };

  if (options.body) {
    fetchOptions.headers = {
      ...fetchOptions.headers,
      "Content-Type": "application/json",
    };
    fetchOptions.body = JSON.stringify(options.body);
  }

  const response = await fetchWithTimeout(url.toString(), fetchOptions);

  if (!response.ok) {
    let message: string;
    try {
      const text = await response.text();
      message = text || response.statusText;
    } catch {
      message = response.statusText;
    }

    if (message.length > MAX_UPSTREAM_ERROR_CHARS) {
      message = `${message.slice(
        0,
        MAX_UPSTREAM_ERROR_CHARS
      )}... [truncated upstream error body]`;
    }

    throw new ApiError(response.status, `${response.status}: ${message}`);
  }

  try {
    return await response.json();
  } catch {
    throw new ApiError(502, "502: Upstream API returned invalid JSON");
  }
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
  const response = await fetchWithTimeout(`${API_BASE}/v3/getip`);
  if (!response.ok) {
    throw new ApiError(response.status, "Failed to retrieve IP address");
  }
  let data: { ip: string };
  try {
    data = (await response.json()) as { ip: string };
  } catch {
    throw new ApiError(502, "502: Upstream API returned invalid JSON");
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
