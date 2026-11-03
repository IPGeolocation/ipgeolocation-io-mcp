import { getMaxToolArgumentBytes } from "../config.js";
import { ResourceLimitError } from "../errors.js";

export function validateToolArgumentSize(args: unknown): void {
  let json: string | undefined;
  try { json = JSON.stringify(args); }
  catch { throw new Error("Tool arguments could not be safely encoded as JSON. Reduce excessive nesting or unsupported values."); }
  if (json === undefined) throw new Error("Tool arguments could not be safely encoded as JSON. Reduce excessive nesting or unsupported values.");
  const limit = getMaxToolArgumentBytes();
  if (Buffer.byteLength(json, "utf8") > limit) {
    throw new ResourceLimitError(`Tool arguments exceed the ${limit}-byte limit. Reduce the input batch or selector size. No API call was made.`);
  }
}

const LOOKUP_ARGUMENTS = new Set([
  "ip", "asn", "lang", "tz", "lat", "long", "location",
  "iata_code", "icao_code", "lo_code", "tz_from", "tz_to",
  "lat_from", "long_from", "lat_to", "long_to", "location_from", "location_to",
  "iata_from", "iata_to", "icao_from", "icao_to", "locode_from", "locode_to",
  "date", "dateStart", "dateEnd", "elevation", "time_zone", "time",
]);

function normalizeLookupValue(value: unknown, name: string, label = name): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`'${label}' must be a non-blank string. Omit optional selectors to use their defaults.`);
  }
  const normalized = value.trim();
  if (name === "ip" || name === "lang") return normalized.toLowerCase();
  if (name === "asn") return normalized.toUpperCase();
  if (name === "elevation") {
    const elevation = parseNumber(normalized);
    if (elevation !== null && elevation < 0) return "0";
  }
  return normalized;
}

export function normalizeLookupArguments<T extends Record<string, unknown>>(args: T): T {
  const normalized: Record<string, unknown> = { ...args };
  for (const [name, value] of Object.entries(args)) {
    if (value === undefined) continue;
    if (LOOKUP_ARGUMENTS.has(name)) {
      normalized[name] = normalizeLookupValue(value, name);
    } else if (name === "fields" || name === "excludes") {
      if (typeof value !== "string") throw new Error(`'${name}' must be a string.`);
      normalized[name] = value.split(",").map(part => part.trim()).filter(Boolean).sort().join(",");
    } else if (name === "ips") {
      if (!Array.isArray(value) || value.length === 0) throw new Error("'ips' must be a non-empty array of non-blank strings.");
      normalized[name] = Array.from(value, (ip, index) => normalizeLookupValue(ip, "ip", `ips[${index}]`));
    } else if (name === "uaString") {
      normalizeLookupValue(value, name);
    } else if (name === "uaStrings") {
      if (!Array.isArray(value) || value.length === 0) throw new Error("'uaStrings' must be a non-empty array of non-blank strings.");
      for (const [index, ua] of value.entries()) normalizeLookupValue(ua, "uaString", `uaStrings[${index}]`);
    }
  }
  if (normalized.asn !== undefined) normalized.ip = undefined;
  return normalized as T;
}

function hasValue(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== "";
}

function parseNumber(value: string): number | null {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function validateCoordinateValue(
  value: string,
  fieldName: string,
  min: number,
  max: number,
  label: string
): string | null {
  const parsed = parseNumber(value);
  if (parsed === null || parsed < min || parsed > max) {
    return `${label}: '${fieldName}' must be a number between ${min} and ${max}.`;
  }

  return null;
}

export function validateCoordinatePair(
  lat: string | undefined,
  long: string | undefined,
  label: string
): string | null {
  const hasLat = hasValue(lat);
  const hasLong = hasValue(long);
  if (hasLat === hasLong) {
    if (!hasLat) {
      return null;
    }

    const latError = validateCoordinateValue(lat!, "lat", -90, 90, label);
    if (latError) {
      return latError;
    }

    return validateCoordinateValue(long!, "long", -180, 180, label);
  }

  return `${label}: 'lat' and 'long' must be provided together.`;
}

export function validateCoordinatePairNamed(
  lat: string | undefined,
  long: string | undefined,
  latName: string,
  longName: string,
  label: string
): string | null {
  const hasLat = hasValue(lat);
  const hasLong = hasValue(long);
  if (hasLat === hasLong) {
    if (!hasLat) {
      return null;
    }

    const latError = validateCoordinateValue(
      lat!,
      latName,
      -90,
      90,
      label
    );
    if (latError) {
      return latError;
    }

    return validateCoordinateValue(long!, longName, -180, 180, label);
  }

  return `${label}: '${latName}' and '${longName}' must be provided together.`;
}

function parseIsoDate(date: string): Date | null {
  const normalized = date.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) return null;
  return parsed;
}

export function validateIsoDate(
  value: string | undefined,
  fieldName: string
): string | null {
  if (!hasValue(value)) {
    return null;
  }

  const parsed = parseIsoDate(value!.trim());
  if (!parsed) {
    return `${fieldName} must be in YYYY-MM-DD format.`;
  }

  return null;
}

export function validateDateRange(
  dateStart: string,
  dateEnd: string,
  maxDays: number
): string | null {
  const start = parseIsoDate(dateStart);
  if (!start) {
    return "dateStart must be in YYYY-MM-DD format.";
  }

  const end = parseIsoDate(dateEnd);
  if (!end) {
    return "dateEnd must be in YYYY-MM-DD format.";
  }

  if (end.getTime() < start.getTime()) {
    return "dateEnd must be greater than or equal to dateStart.";
  }

  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const daySpan = Math.floor((end.getTime() - start.getTime()) / millisecondsPerDay);
  if (daySpan > maxDays) {
    return `The maximum allowed range between dateStart and dateEnd is ${maxDays} days.`;
  }

  return null;
}

export function hasAnyValue(values: Array<string | undefined>): boolean {
  return values.some(hasValue);
}

export function validateElevation(
  value: string | undefined,
  fieldName: string
): string | null {
  if (!hasValue(value)) {
    return null;
  }

  const parsed = parseNumber(value!);
  if (parsed === null || parsed > 10000) {
    return `${fieldName} must be a finite number no greater than 10000. Negative values are treated as 0.`;
  }

  return null;
}

export function validateTimezoneConversionTime(
  value: string | undefined,
  fieldName: string
): string | null {
  if (!hasValue(value)) {
    return null;
  }

  const normalized = value!.trim();
  const match = normalized.match(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (!match) {
    return `${fieldName} must be in yyyy-MM-dd HH:mm or yyyy-MM-dd HH:mm:ss format.`;
  }

  const [, datePart, hourPart, minutePart, secondPart] = match;
  if (!parseIsoDate(datePart)) {
    return `${fieldName} must be in yyyy-MM-dd HH:mm or yyyy-MM-dd HH:mm:ss format.`;
  }

  const hour = Number.parseInt(hourPart, 10);
  const minute = Number.parseInt(minutePart, 10);
  const second =
    secondPart === undefined ? 0 : Number.parseInt(secondPart, 10);

  if (
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return `${fieldName} must be in yyyy-MM-dd HH:mm or yyyy-MM-dd HH:mm:ss format.`;
  }

  return null;
}
