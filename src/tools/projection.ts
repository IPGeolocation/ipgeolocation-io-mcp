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

    const firstSegment = path.slice(0, path.indexOf("."));
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

type PathSelection = { selectedAt: number; children: Map<string, PathSelection> };
type SourcePaths = { values: unknown[]; children?: Map<string, SourcePaths> };

function pathSelection(): PathSelection {
  return { selectedAt: Infinity, children: new Map() };
}

function sourceChild(source: SourcePaths, key: string): SourcePaths | undefined {
  const single = source.values.length === 1 ? source.values[0] : undefined;
  if (isObject(single)) {
    if (!Object.prototype.hasOwnProperty.call(single, key)) return undefined;
    source.children ??= new Map();
    let child = source.children.get(key);
    if (!child) {
      child = { values: [getOwnValue(single, key)] };
      source.children.set(key, child);
    }
    return child;
  }
  if (!source.children) {
    source.children = new Map();
    const collect = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const item of value) collect(item);
      } else if (isObject(value)) {
        for (const [name, childValue] of Object.entries(value)) {
          let child = source.children!.get(name);
          if (!child) {
            child = { values: [] };
            source.children!.set(name, child);
          }
          child.values.push(childValue);
        }
      }
    };
    for (const value of source.values) collect(value);
  }
  return source.children.get(key);
}

function addPath(selection: PathSelection, source: SourcePaths, path: string, index: number): void {
  const segments: string[] = [];
  let offset = 0;
  let matched = true;
  for (;;) {
    const dot = path.indexOf(".", offset);
    const segment = path.slice(offset, dot === -1 ? undefined : dot);
    const child = sourceChild(source, segment);
    if (!child) { matched = false; break; }
    segments.push(segment);
    source = child;
    if (dot === -1) break;
    offset = dot + 1;
  }
  for (const segment of segments) {
    let child = selection.children.get(segment);
    if (!child) {
      child = pathSelection();
      selection.children.set(segment, child);
    }
    selection = child;
  }
  if (matched) selection.selectedAt = Math.min(selection.selectedAt, index);
}

function projectPaths(source: unknown, selection: PathSelection): unknown {
  if (Number.isFinite(selection.selectedAt)) {
    return clone(source);
  }

  if (Array.isArray(source)) {
    // Project each row once so missing fields cannot shift values onto another row.
    return source.map(item => projectPaths(item, selection) ?? (isObject(item) ? {} : null));
  }

  if (!isObject(source)) {
    return undefined;
  }

  const projected: JsonObject = {};
  for (const [key, value] of Object.entries(source)) {
    const selected = selection.children.get(key);
    if (!selected) continue;
    const child = projectPaths(value, selected);
    if (child !== undefined) setOwnValue(projected, key, child);
  }
  return Object.keys(projected).length > 0 ? projected : undefined;
}

function removeSelectedPaths(target: unknown, selection: PathSelection): number {
  if (selection.children.size === 0) return selection.selectedAt;
  if (Array.isArray(target)) {
    // Arrays retain their rows even when every row becomes an empty object.
    if (!Number.isFinite(selection.selectedAt)) {
      for (const item of target) removeSelectedPaths(item, selection);
    }
    return selection.selectedAt;
  }
  if (!isObject(target)) return selection.selectedAt;
  const entries = Object.entries(target);
  let allRemoved = entries.length > 0;
  let lastRemoval = -Infinity;
  for (const [key, value] of entries) {
    const selected = selection.children.get(key);
    const removedAt = selected ? removeSelectedPaths(value, selected) : Infinity;
    if (Number.isFinite(removedAt)) {
      Reflect.deleteProperty(target, key);
      lastRemoval = Math.max(lastRemoval, removedAt);
    } else {
      allRemoved = false;
    }
  }
  return allRemoved ? Math.min(selection.selectedAt, lastRemoval) : selection.selectedAt;
}

function excludePaths(target: unknown, paths: string[], rootKey?: string): void {
  const selection = pathSelection();
  const source: SourcePaths = { values: [target] };
  const initialHeads: string[] = [];
  for (const [index, path] of paths.entries()) {
    const normalized = normalizePath(path, target, rootKey)!;
    const dot = normalized.indexOf(".");
    initialHeads.push(normalized.slice(0, dot === -1 ? undefined : dot));
    addPath(selection, source, normalized, index);
  }
  if (!rootKey || !isObject(target) || !Object.prototype.hasOwnProperty.call(target, rootKey)) {
    removeSelectedPaths(target, selection);
    return;
  }
  const removedAt = new Map<string, number>();
  for (const [key, value] of Object.entries(target)) {
    if (key === rootKey) continue;
    const selected = selection.children.get(key);
    if (!selected) continue;
    const index = removeSelectedPaths(value, selected);
    if (Number.isFinite(index)) {
      Reflect.deleteProperty(target, key);
      removedAt.set(key, index);
    }
  }
  // A later selector can fall back to rootKey after a top-level object is
  // removed, including removal caused by pruning its final nested property.
  for (const [index, path] of paths.entries()) {
    if ((removedAt.get(initialHeads[index]) ?? Infinity) < index) {
      addPath(selection, source, `${rootKey}.${path}`, index);
    }
  }
  const root = selection.children.get(rootKey);
  if (root && Number.isFinite(removeSelectedPaths(getOwnValue(target, rootKey), root))) {
    Reflect.deleteProperty(target, rootKey);
  }
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
    const selection = pathSelection();
    const sourcePaths: SourcePaths = { values: [source] };
    for (const path of fieldPaths) {
      const normalized = normalizePath(path, source, rootKey);
      if (normalized) addPath(selection, sourcePaths, normalized, 0);
    }
    result = projectPaths(source, selection) ?? {};
  } else {
    result = clone(source);
  }

  const excludedPaths = splitCsv(excludes);
  if (excludedPaths.length > 0) excludePaths(result, excludedPaths, rootKey);

  const ip = isObject(source) ? getOwnValue(source, "ip") : undefined;
  if (preserveIp && typeof ip === "string" && isObject(result)) {
    setOwnValue(result, "ip", ip);
  }
  return result;
}
