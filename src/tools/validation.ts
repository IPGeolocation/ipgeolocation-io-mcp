function hasValue(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== "";
}

export function validateCoordinatePair(
  lat: string | undefined,
  long: string | undefined,
  label: string
): string | null {
  const hasLat = hasValue(lat);
  const hasLong = hasValue(long);
  if (hasLat === hasLong) {
    return null;
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
    return null;
  }

  return `${label}: '${latName}' and '${longName}' must be provided together.`;
}

function parseIsoDate(date: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }

  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

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
