import {
  getMaxBulkItems,
  getMaxErrorChars,
  getMaxItemsInResponse,
  getMaxResponseChars,
} from "../config.js";

export const MAX_BULK_ITEMS = getMaxBulkItems();

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function prepareArraysForTransport(
  value: unknown,
  state: { nestedArraysTruncated: boolean },
  topLevel = false
): unknown {
  if (Array.isArray(value)) {
    const maxItemsInResponse = getMaxItemsInResponse();
    const items = value
      .slice(0, maxItemsInResponse)
      .map((item) => prepareArraysForTransport(item, state));

    if (value.length <= maxItemsInResponse) {
      return items;
    }

    if (topLevel) {
      return {
        truncated: true,
        total_items: value.length,
        shown_items: maxItemsInResponse,
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
  const maxResponseChars = getMaxResponseChars();
  let preview = text;

  while (true) {
    const payload = JSON.stringify(
      {
        truncated: true,
        note: `Response exceeded ${maxResponseChars.toLocaleString()} characters. Narrow the query or request fewer fields.`,
        total_chars: text.length,
        shown_chars: preview.length,
        preview,
      },
      null,
      2
    );

    if (payload.length <= maxResponseChars || preview.length === 0) {
      return payload;
    }

    const overflow = payload.length - maxResponseChars;
    const reduction = Math.max(overflow, Math.ceil(preview.length * 0.1), 1);
    preview = preview.slice(0, Math.max(0, preview.length - reduction));
  }
}

export function formatToolResult(result: unknown): string {
  const prepared = prepareResultForTransport(result);
  const text = JSON.stringify(prepared, null, 2);
  const maxResponseChars = getMaxResponseChars();

  if (text.length <= maxResponseChars) {
    return text;
  }

  return buildOversizedResponsePayload(text);
}

export function errorToolResponse(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const maxErrorChars = getMaxErrorChars();
  const message =
    rawMessage.length <= maxErrorChars
      ? rawMessage
      : `${rawMessage.slice(
          0,
          maxErrorChars
        )}... [error truncated at ${maxErrorChars.toLocaleString()} characters]`;

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
