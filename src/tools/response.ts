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

function prepareResultForTransport(result: unknown): unknown {
  if (!Array.isArray(result) || result.length <= MAX_ITEMS_IN_RESPONSE) {
    return result;
  }

  return {
    truncated: true,
    total_items: result.length,
    shown_items: MAX_ITEMS_IN_RESPONSE,
    note: `Response truncated for MCP transport safety. Narrow your query or split the request into smaller batches.`,
    items: result.slice(0, MAX_ITEMS_IN_RESPONSE),
  };
}

export function formatToolResult(result: unknown): string {
  const prepared = prepareResultForTransport(result);
  const text = JSON.stringify(prepared, null, 2);

  if (text.length <= MAX_RESPONSE_CHARS) {
    return text;
  }

  return `${text.slice(
    0,
    MAX_RESPONSE_CHARS
  )}\n... [response truncated at ${MAX_RESPONSE_CHARS.toLocaleString()} characters]`;
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
