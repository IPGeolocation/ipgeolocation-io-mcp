import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getCacheTtlMs, getMaxResponseChars } from "../config.js";
import { redactSensitiveValue } from "../redaction.js";
import { getCachedValue, setCachedValue } from "./cache.js";

export const cachedResultCursorSchema = z.string().max(80).regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}:\d{1,16}$/)
  .describe("Opaque cursor returned in page.cursor or page.next_cursor. Retrieval requires the same server process and API key and does not repeat the original lookup.");

export const cachedResultPageSchema = z.object({
  source_tool: z.string(),
  format: z.literal("structuredContent_json"),
  json_fragment: z.string().describe("JSON fragment of the original structuredContent. Fragments concatenate in offset order into the complete JSON, including bulk items and errors."),
  offset: z.number().int().nonnegative(),
  total_chars: z.number().int().nonnegative(),
  cursor: cachedResultCursorSchema,
  next_cursor: cachedResultCursorSchema.optional().describe("Cursor for the next get_cached_result page, absent on the last page. Page reads never call the API or consume credits."),
  expires_at: z.string().describe("ISO timestamp for idle expiry. Successful page reads extend the cache TTL; eviction or process restart can also remove the result."),
});

type CachedResult = { json: string; sourceTool: string; expiresAt: number };
const cacheKey = (id: string) => `result-page|${id}`;

function pageResponse(id: string, snapshot: CachedResult, offset: number, end: number): CallToolResult {
  // Keep UTF-16 surrogate pairs together so clients can decode each fragment safely.
  if (end < snapshot.json.length && /[\uD800-\uDBFF]/.test(snapshot.json[end - 1]) && /[\uDC00-\uDFFF]/.test(snapshot.json[end])) end--;
  const page = {
    source_tool: snapshot.sourceTool,
    format: "structuredContent_json",
    json_fragment: snapshot.json.slice(offset, end),
    offset,
    total_chars: snapshot.json.length,
    cursor: `${id}:${offset}`,
    ...(end < snapshot.json.length ? { next_cursor: `${id}:${end}` } : {}),
    expires_at: new Date(snapshot.expiresAt).toISOString(),
  };
  return { content: [{ type: "text", text: JSON.stringify({ page }) }], structuredContent: { page } };
}

function fits(result: CallToolResult): boolean {
  return Buffer.byteLength(JSON.stringify(result), "utf8") <= getMaxResponseChars();
}

function readPage(id: string, snapshot: CachedResult, offset: number): CallToolResult {
  const upper = Math.min(snapshot.json.length, offset + getMaxResponseChars());
  const full = pageResponse(id, snapshot, offset, upper);
  if (fits(full)) return full;
  let low = offset + 1;
  let high = upper - 1;
  let best: CallToolResult | undefined;
  while (low <= high) {
    const end = Math.floor((low + high) / 2);
    const candidate = pageResponse(id, snapshot, offset, end);
    if (fits(candidate)) {
      best = candidate;
      low = end + 1;
    } else high = end - 1;
  }
  if (!best) throw new Error("The configured response limit cannot fit cached-result metadata.");
  return best;
}

export function paginateToolResult(name: string, result: CallToolResult): CallToolResult {
  if (fits(result)) return result;
  const id = randomUUID();
  const snapshot: CachedResult = {
    json: JSON.stringify(redactSensitiveValue(result.structuredContent)),
    sourceTool: name,
    expiresAt: Date.now() + getCacheTtlMs(),
  };
  setCachedValue(cacheKey(id), snapshot);
  return readPage(id, snapshot, 0);
}

export function readCachedResultPage(cursor: string): CallToolResult {
  if (!cachedResultCursorSchema.safeParse(cursor).success) throw new Error("Invalid cached-result cursor.");
  const [id, position] = cursor.split(":");
  const offset = Number(position);
  if (!Number.isSafeInteger(offset)) throw new Error("Invalid cached-result cursor.");
  const snapshot = getCachedValue(cacheKey(id)) as CachedResult | undefined;
  if (!snapshot) throw new Error("Cached result is unavailable or expired. No API call was made. A new lookup may consume credits.");
  if (offset >= snapshot.json.length || (offset > 0 && /[\uDC00-\uDFFF]/.test(snapshot.json[offset]))) throw new Error("Invalid cached-result cursor position.");
  snapshot.expiresAt = Date.now() + getCacheTtlMs();
  setCachedValue(cacheKey(id), snapshot);
  return readPage(id, snapshot, offset);
}
