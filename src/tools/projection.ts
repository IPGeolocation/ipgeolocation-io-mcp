type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getOwnValue(source: JsonObject, key: string): unknown {
  return Object.getOwnPropertyDescriptor(source, key)?.value;
}

function setOwnValue(target: JsonObject, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function splitCsv(input: string | undefined): string[] {
  if (!input) {
    return [];
  }
  return input
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

function normalizePath(
  path: string,
  source: unknown,
  rootKey?: string
): string | null {
  if (!path) {
    return null;
  }

  if (path.includes(".")) {
    if (!rootKey || !isObject(source)) {
      return path;
    }

    if (path === rootKey || path.startsWith(`${rootKey}.`)) {
      return path;
    }

    const firstSegment = path.split(".")[0];
    if (Object.prototype.hasOwnProperty.call(source, firstSegment)) {
      return path;
    }

    if (Object.prototype.hasOwnProperty.call(source, rootKey)) {
      return `${rootKey}.${path}`;
    }

    return path;
  }

  if (!rootKey || !isObject(source)) {
    return path;
  }

  if (Object.prototype.hasOwnProperty.call(source, path)) {
    return path;
  }

  if (Object.prototype.hasOwnProperty.call(source, rootKey)) {
    return `${rootKey}.${path}`;
  }

  return path;
}

function projectPaths(source: unknown, paths: string[][]): unknown {
  if (paths.some(segments => segments.length === 0)) {
    return clone(source);
  }

  if (Array.isArray(source)) {
    // Project each row once so missing fields cannot shift values onto another row.
    return source.map(item => projectPaths(item, paths) ?? (isObject(item) ? {} : null));
  }

  if (!isObject(source)) {
    return undefined;
  }

  const projected: JsonObject = {};
  for (const [key, value] of Object.entries(source)) {
    const matchingPaths = paths.filter(segments => segments[0] === key);
    if (matchingPaths.length === 0) continue;
    const child = projectPaths(value, matchingPaths.map(segments => segments.slice(1)));
    if (child !== undefined) setOwnValue(projected, key, child);
  }
  return Object.keys(projected).length > 0 ? projected : undefined;
}

function removePath(target: unknown, segments: string[]): void {
  if (segments.length === 0) {
    return;
  }

  if (Array.isArray(target)) {
    for (const item of target) {
      removePath(item, segments);
    }
    return;
  }

  if (!isObject(target)) {
    return;
  }

  const [head, ...tail] = segments;
  if (!Object.prototype.hasOwnProperty.call(target, head)) {
    return;
  }

  if (tail.length === 0) {
    Reflect.deleteProperty(target, head);
    return;
  }

  removePath(getOwnValue(target, head), tail);
}

export function applyFieldsAndExcludes(
  source: unknown,
  options: {
    fields?: string;
    excludes?: string;
    rootKey?: string;
    preserveIp?: boolean;
  } = {}
): unknown {
  const { fields, excludes, rootKey, preserveIp } = options;

  let result: unknown;
  const fieldPaths = splitCsv(fields);

  if (fieldPaths.length > 0) {
    const paths = fieldPaths.map(path => normalizePath(path, source, rootKey))
      .filter((path): path is string => path !== null).map(path => path.split("."));
    result = projectPaths(source, paths) ?? {};
  } else {
    result = clone(source);
  }

  for (const path of splitCsv(excludes)) {
    const normalized = normalizePath(path, result, rootKey);
    if (!normalized) {
      continue;
    }
    removePath(result, normalized.split("."));
  }

  const ip = isObject(source) ? getOwnValue(source, "ip") : undefined;
  if (preserveIp && typeof ip === "string" && isObject(result)) {
    setOwnValue(result, "ip", ip);
  }
  return result;
}
