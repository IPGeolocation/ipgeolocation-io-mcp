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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }

  const [yearPart, monthPart, dayPart] = normalized.split("-");
  const year = Number.parseInt(yearPart, 10);
  const month = Number.parseInt(monthPart, 10);
  const day = Number.parseInt(dayPart, 10);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day)
  ) {
    return null;
  }

  if (month < 1 || month > 12) {
    return null;
  }

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) {
    return null;
  }

  return new Date(Date.UTC(year, month - 1, day));
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
  if (parsed === null || parsed < 0 || parsed > 10000) {
    return `${fieldName} must be a number between 0 and 10000.`;
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
