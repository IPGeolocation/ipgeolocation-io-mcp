import test from "node:test";
import assert from "node:assert/strict";
import { withRuntimeConfig } from "../dist/config.js";
import { setCachedValue, getCachedValue, clearToolCacheForTests } from "../dist/tools/cache.js";
import { paginateToolResult, readCachedResultPage } from "../dist/tools/pagination.js";
import { hosted, upstream, connect, KEY_A, KEY_B } from "./fixtures/hosted.fixture.mjs";

test("one hosted key's large paid reports do not evict another key's saved result", async t => {
  const api = await upstream(t, call => ({ ip: call.url.searchParams.get("ip"), rows: [{ note: "x".repeat(8_000_000) }] }));
  const service = await hosted(t);
  const a = await connect(t, service.url, KEY_A);
  const b = await connect(t, service.url, KEY_B);
  const first = await a.call("lookup_ip", { ip: "8.8.8.8" });
  const cursor = first.structuredContent.page.next_cursor;
  assert.ok(cursor);
  for (let i = 1; i <= 4; i++) {
    const next = await b.call("lookup_ip", { ip: "1.1.1." + i });
    assert.equal(next.isError, undefined);
    assert.ok(next.structuredContent.page);
  }
  const page = await a.call("get_cached_result", { cursor });
  assert.equal(page.isError, undefined);
  assert.equal(page.structuredContent.page.cursor, cursor);
  assert.equal(api.calls.length, 5, "page retrieval makes no replacement API request");
});

test("one hosted key can use the full cache and replaces its older entries only under global pressure", t => {
  const original = process.env.IPGEOLOCATION_MCP_CACHE_MAX_ENTRIES;
  process.env.IPGEOLOCATION_MCP_CACHE_MAX_ENTRIES = "10";
  t.after(() => { original === undefined ? delete process.env.IPGEOLOCATION_MCP_CACHE_MAX_ENTRIES : process.env.IPGEOLOCATION_MCP_CACHE_MAX_ENTRIES = original; clearToolCacheForTests(); });
  const scoped = (key, hosted, action) => withRuntimeConfig({ apiKey: key, hosted }, action);
  clearToolCacheForTests();
  for (let i = 0; i < 10; i++) scoped(KEY_B, true, () => setCachedValue("item-" + i, { value: i }));
  for (let i = 0; i < 10; i++) assert.deepEqual(scoped(KEY_B, true, () => getCachedValue("item-" + i)), { value: i });
  clearToolCacheForTests();
  scoped(KEY_A, true, () => setCachedValue("protected", { value: "A" }));
  for (let i = 0; i < 14; i++) scoped(KEY_B, true, () => setCachedValue("item-" + i, { value: i }));
  assert.deepEqual(scoped(KEY_A, true, () => getCachedValue("protected")), { value: "A" });
  assert.equal(scoped(KEY_B, true, () => getCachedValue("item-0")), undefined);
  assert.deepEqual(scoped(KEY_B, true, () => getCachedValue("item-13")), { value: 13 });
  clearToolCacheForTests();
  for (let i = 0; i < 10; i++) scoped(KEY_A, false, () => setCachedValue("local-" + i, { value: i }));
  for (let i = 0; i < 10; i++) assert.deepEqual(scoped(KEY_A, false, () => getCachedValue("local-" + i)), { value: i });
});

test("hosted pagination can use more than half the cache, but rejects snapshots above global capacity", t => {
  clearToolCacheForTests();
  t.after(() => clearToolCacheForTests());
  withRuntimeConfig({ apiKey: KEY_A, hosted: true }, () => setCachedValue("protected", { value: "A" }));
  const report = { content: [{ type: "text", text: "fixture" }], structuredContent: { data: { blob: "x".repeat(17 * 1024 * 1024) } } };
  const page = withRuntimeConfig({ apiKey: KEY_B, hosted: true }, () => paginateToolResult("lookup_ip", report));
  assert.ok(page.structuredContent.page);
  assert.ok(withRuntimeConfig({ apiKey: KEY_B, hosted: true }, () => readCachedResultPage(page.structuredContent.page.next_cursor)));
  const oversized = { ...report, structuredContent: { data: { blob: "x".repeat(33 * 1024 * 1024) } } };
  assert.throws(() => withRuntimeConfig({ apiKey: KEY_B, hosted: true }, () => paginateToolResult("lookup_ip", oversized)), /exceeds IPGEOLOCATION_MCP_CACHE_MAX_BYTES/);
  assert.deepEqual(withRuntimeConfig({ apiKey: KEY_A, hosted: true }, () => getCachedValue("protected")), { value: "A" });
});
