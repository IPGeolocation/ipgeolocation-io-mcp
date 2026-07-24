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

function projectPath(source: unknown, segments: string[]): unknown {
  if (segments.length === 0) {
    return clone(source);
  }

  if (Array.isArray(source)) {
    const items = source
      .map((item) => projectPath(item, segments))
      .filter((item) => item !== undefined);
    return items.length > 0 ? items : undefined;
  }

  if (!isObject(source)) {
    return undefined;
  }

  const [head, ...tail] = segments;
  if (!Object.prototype.hasOwnProperty.call(source, head)) {
    return undefined;
  }

  const child = projectPath(getOwnValue(source, head), tail);
  if (child === undefined) {
    return undefined;
  }

  return Object.fromEntries([[head, child]]);
}

function mergeProjected(target: unknown, source: unknown): unknown {
  if (source === undefined) {
    return target;
  }
  if (target === undefined) {
    return clone(source);
  }

  if (Array.isArray(target) && Array.isArray(source)) {
    const max = Math.max(target.length, source.length);
    return Array.from({ length: max }, (_, i) => {
      if (i in target && i in source) {
        return mergeProjected(target.at(i), source.at(i));
      }
      if (i in source) {
        return clone(source.at(i));
      }
      return clone(target.at(i));
    });
  }

  if (isObject(target) && isObject(source)) {
    const merged: JsonObject = Object.fromEntries(Object.entries(target));
    for (const [key, value] of Object.entries(source)) {
      if (Object.prototype.hasOwnProperty.call(merged, key)) {
        setOwnValue(merged, key, mergeProjected(getOwnValue(merged, key), value));
      } else {
        setOwnValue(merged, key, clone(value));
      }
    }
    return merged;
  }

  return clone(source);
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
  } = {}
): unknown {
  const { fields, excludes, rootKey } = options;

  let result: unknown;
  const fieldPaths = splitCsv(fields);

  if (fieldPaths.length > 0) {
    let projected: unknown = undefined;
    for (const path of fieldPaths) {
      const normalized = normalizePath(path, source, rootKey);
      if (!normalized) {
        continue;
      }
      const candidate = projectPath(source, normalized.split("."));
      projected = mergeProjected(projected, candidate);
    }
    result = projected === undefined ? {} : projected;
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

  return result;
}
