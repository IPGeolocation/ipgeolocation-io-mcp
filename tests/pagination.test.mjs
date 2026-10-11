import test from "node:test";
import assert from "node:assert/strict";
import { formatToolResult, formatBulkToolResult, toolOutputSchema, withStructuredContent } from "../dist/tools/response.js";
import { clearToolCacheForTests } from "../dist/tools/cache.js";
import { withRuntimeConfig } from "../dist/config.js";

function setup(t) {
  const names = ["IPGEOLOCATION_API_KEY", "IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS", "IPGEOLOCATION_MCP_CACHE_TTL_MS", "IPGEOLOCATION_MCP_CACHE_MAX_ENTRIES"];
  const previous = names.map(name => process.env[name]);
  process.env.IPGEOLOCATION_API_KEY = "pagination-test-secret";
  process.env.IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS = "10000";
  delete process.env.IPGEOLOCATION_MCP_CACHE_TTL_MS;
  delete process.env.IPGEOLOCATION_MCP_CACHE_MAX_ENTRIES;
  clearToolCacheForTests();
  t.after(() => {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
    clearToolCacheForTests();
  });
}

function output(name, data, args = {}) {
  const text = name.startsWith("bulk_") ? formatBulkToolResult(data) : formatToolResult(data);
  return withStructuredContent(name, args, { content: [{ type: "text", text }] });
}

async function collect(first, limit = 10000) {
  const { readCachedResultPage } = await import("../dist/tools/pagination.js");
  let result = first;
  let json = "";
  let pages = 0;
  for (;;) {
    assert.equal(result.isError, undefined);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= limit, "complete serialized result must fit, including escaped text and structured content");
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
    const page = result.structuredContent.page;
    assert.equal(page.offset, json.length);
    assert.doesNotMatch(page.json_fragment, /pagination-test-secret/);
    assert.doesNotMatch(page.json_fragment, /^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
    assert.equal(toolOutputSchema(pages === 0 ? page.source_tool : "get_cached_result").safeParse(result.structuredContent).success, true);
    json += page.json_fragment;
    pages++;
    assert.ok(pages < 1000, "pagination must make progress");
    if (!page.next_cursor) {
      assert.equal(json.length, page.total_chars);
      return { data: JSON.parse(json), pages };
    }
    result = readCachedResultPage(page.next_cursor);
  }
}

test("normal results retain their existing text and structured content", async t => {
  setup(t);
  const data = { ip: "8.8.8.8", location: { country_name: "United States" } };
  const text = formatToolResult(data);
  assert.deepEqual(output("lookup_ip", data), { content: [{ type: "text", text }], structuredContent: { data } });
  assert.deepEqual(output("bulk_lookup_ip", [data], { ips: [data.ip] }).structuredContent, { items: [data], errors: [] });
});

test("oversized JSON preserves nested arrays, Unicode, escapes, and redaction across pages", async t => {
  setup(t);
  const data = {
    routes: Array.from({ length: 1000 }, (_, index) => ({ index })),
    notes: '"\\\n😀☀'.repeat(4000),
    echoed_key: "pagination-test-secret",
  };
  const first = output("lookup_asn", data);
  assert.ok(first.structuredContent.page, "oversized results must be recoverable pages, not a truncated preview");
  const recovered = await collect(first);
  assert.ok(recovered.pages > 1);
  assert.deepEqual(recovered.data, { data: { ...data, echoed_key: "[REDACTED_API_KEY]" } });
});

test("one oversized bulk record and per-item error identifiers are fully recoverable", async t => {
  setup(t);
  const data = [{ ip: "8.8.8.8", details: "x".repeat(50000) }, { message: "Temporary failure", status: 503 }];
  const first = output("bulk_lookup_ip", data, { ips: ["8.8.8.8", "10.0.0.1"] });
  const { data: recovered } = await collect(first);
  assert.deepEqual(recovered.items, data);
  assert.equal(recovered.errors[0].input_index, 1);
  assert.equal(recovered.errors[0].input, "10.0.0.1");
  assert.equal(recovered.errors[0].status, 503);
  assert.equal(recovered.errors[0].retryable, true);
});

test("the budget includes duplicated structured content and UTF-8 transport encoding", async t => {
  setup(t);
  const data = { text: "é".repeat(7000) };
  assert.ok(formatToolResult(data).length < 10000);
  const recovered = await collect(output("lookup_ip", data));
  assert.deepEqual(recovered.data, { data });
});

test("results above the default 200,000-byte limit are recovered completely", async t => {
  setup(t);
  delete process.env.IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS;
  const data = { notes: "x".repeat(500000) };
  const recovered = await collect(output("lookup_asn", data), 200000);
  assert.ok(recovered.pages > 1);
  assert.deepEqual(recovered.data, { data });
});

test("pagination does not bypass original output validation or input-count checks", async t => {
  setup(t);
  assert.throws(() => output("bulk_lookup_ip", ["x".repeat(20000)], { ips: ["8.8.8.8"] }), /invalid structured output/);
  assert.throws(() => output("bulk_lookup_ip", [{ notes: "x".repeat(20000) }], { ips: ["8.8.8.8", "1.1.1.1"] }), /item count did not match/);
});

test("cursors are scoped by API key and retries return the same fragment without network access", async t => {
  setup(t);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("Cached pages must never access the network"); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const { readCachedResultPage } = await import("../dist/tools/pagination.js");
  const first = withRuntimeConfig({ apiKey: "owner-key" }, () => output("lookup_asn", { notes: "x".repeat(30000) }));
  const cursor = first.structuredContent.page.cursor;
  assert.throws(() => withRuntimeConfig({ apiKey: "other-key" }, () => readCachedResultPage(cursor)), /unavailable|expired/i);
  const replay = withRuntimeConfig({ apiKey: "owner-key" }, () => readCachedResultPage(cursor));
  assert.equal(replay.structuredContent.page.json_fragment, first.structuredContent.page.json_fragment);
  assert.equal(replay.structuredContent.page.next_cursor, first.structuredContent.page.next_cursor);
});

test("page reads extend idle expiry; expired and evicted cursors never refetch", async t => {
  setup(t);
  process.env.IPGEOLOCATION_MCP_CACHE_TTL_MS = "1000";
  process.env.IPGEOLOCATION_MCP_CACHE_MAX_ENTRIES = "10";
  const originalNow = Date.now;
  let now = 100000;
  Date.now = () => now;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("Expired cached pages must never refetch"); };
  t.after(() => { Date.now = originalNow; globalThis.fetch = originalFetch; });
  const { readCachedResultPage } = await import("../dist/tools/pagination.js");
  const cursor = output("lookup_asn", { notes: "x".repeat(30000) }).structuredContent.page.cursor;
  now += 999;
  const extended = readCachedResultPage(cursor);
  assert.equal(Date.parse(extended.structuredContent.page.expires_at), now + 1000);
  now += 999;
  readCachedResultPage(cursor);
  now += 1000;
  assert.throws(() => readCachedResultPage(cursor), /unavailable|expired/i);
  const evicted = output("lookup_asn", { notes: "x".repeat(30000) }).structuredContent.page.cursor;
  for (let index = 0; index < 10; index++) output("lookup_asn", { index, notes: "x".repeat(30000) });
  assert.throws(() => readCachedResultPage(evicted), /unavailable|expired/i);
});

test("invalid cursors and process cache resets fail locally without exposing inputs", async t => {
  setup(t);
  const { readCachedResultPage } = await import("../dist/tools/pagination.js");
  assert.throws(() => readCachedResultPage("pagination-test-secret"), error => {
    assert.doesNotMatch(error.message, /pagination-test-secret/);
    return /cursor/i.test(error.message);
  });
  const cursor = output("lookup_asn", { notes: "x".repeat(30000) }).structuredContent.page.cursor;
  const id = cursor.split(":")[0];
  assert.throws(() => readCachedResultPage(`${id}:999999999999999999`), /cursor/i);
  assert.throws(() => readCachedResultPage(`${id}:999999`), /cursor/i);
  clearToolCacheForTests();
  assert.throws(() => readCachedResultPage(cursor), /unavailable|expired/i);
});
