const DEFAULT_MAX_BULK_ITEMS = 1000;
const DEFAULT_MAX_ITEMS_IN_RESPONSE = 250;
const DEFAULT_MAX_RESPONSE_CHARS = 200000;
const DEFAULT_MAX_ERROR_CHARS = 4000;

function parsePositiveIntEnv(
  name: string,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return fallback;
  }

  return parsed;
}

export const MAX_BULK_ITEMS = parsePositiveIntEnv(
  "IPGEOLOCATION_MCP_MAX_BULK_ITEMS",
  DEFAULT_MAX_BULK_ITEMS,
  1,
  50000
);

const MAX_ITEMS_IN_RESPONSE = parsePositiveIntEnv(
  "IPGEOLOCATION_MCP_MAX_RESULT_ITEMS",
  DEFAULT_MAX_ITEMS_IN_RESPONSE,
  1,
  50000
);

const MAX_RESPONSE_CHARS = parsePositiveIntEnv(
  "IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS",
  DEFAULT_MAX_RESPONSE_CHARS,
  10000,
  2000000
);

const MAX_ERROR_CHARS = parsePositiveIntEnv(
  "IPGEOLOCATION_MCP_MAX_ERROR_CHARS",
  DEFAULT_MAX_ERROR_CHARS,
  200,
  50000
);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function prepareArraysForTransport(
  value: unknown,
  state: { nestedArraysTruncated: boolean },
  topLevel = false
): unknown {
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ITEMS_IN_RESPONSE)
      .map((item) => prepareArraysForTransport(item, state));

    if (value.length <= MAX_ITEMS_IN_RESPONSE) {
      return items;
    }

    if (topLevel) {
      return {
        truncated: true,
        total_items: value.length,
        shown_items: MAX_ITEMS_IN_RESPONSE,
        note: "Response truncated for transport limits. Narrow the query or split batches.",
        items,
      };
    }

    state.nestedArraysTruncated = true;
    return items;
  }

  if (!isObject(value)) {
    return value;
  }

  const prepared: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    prepared[key] = prepareArraysForTransport(entry, state);
  }
  return prepared;
}

function prepareResultForTransport(result: unknown): unknown {
  const state = { nestedArraysTruncated: false };
  const prepared = prepareArraysForTransport(result, state, true);

  if (state.nestedArraysTruncated && isObject(prepared)) {
    return {
      truncated: true,
      note: "Nested arrays were truncated for transport limits. Narrow the query or split batches.",
      result: prepared,
    };
  }

  return prepared;
}

function buildOversizedResponsePayload(text: string): string {
  let preview = text;

  while (true) {
    const payload = JSON.stringify(
      {
        truncated: true,
        note: `Response exceeded ${MAX_RESPONSE_CHARS.toLocaleString()} characters. Narrow the query or request fewer fields.`,
        total_chars: text.length,
        shown_chars: preview.length,
        preview,
      },
      null,
      2
    );

    if (payload.length <= MAX_RESPONSE_CHARS || preview.length === 0) {
      return payload;
    }

    const overflow = payload.length - MAX_RESPONSE_CHARS;
    const reduction = Math.max(overflow, Math.ceil(preview.length * 0.1), 1);
    preview = preview.slice(0, Math.max(0, preview.length - reduction));
  }
}

export function formatToolResult(result: unknown): string {
  const prepared = prepareResultForTransport(result);
  const text = JSON.stringify(prepared, null, 2);

  if (text.length <= MAX_RESPONSE_CHARS) {
    return text;
  }

  return buildOversizedResponsePayload(text);
}

export function errorToolResponse(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message =
    rawMessage.length <= MAX_ERROR_CHARS
      ? rawMessage
      : `${rawMessage.slice(
          0,
          MAX_ERROR_CHARS
        )}... [error truncated at ${MAX_ERROR_CHARS.toLocaleString()} characters]`;

  return {
    content: [
      {
        type: "text" as const,
        text: `Error: ${message}`,
      },
    ],
    isError: true,
  };
}
