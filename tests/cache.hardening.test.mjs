import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../dist/index.js";
import { getRequestSignal, withRequestSignal, withRuntimeConfig } from "../dist/config.js";
import { clearToolCacheForTests, getCachedOrFetchValue, getCachedValue } from "../dist/tools/cache.js";
import { shouldCacheBulkResult, withStructuredContent } from "../dist/tools/response.js";

const syntheticKey = "cache-hardening-synthetic-key";
process.env.IPGEOLOCATION_API_KEY = syntheticKey;
const transient = [{ message: "Synthetic temporary failure", status: 503 }];
const success = [{ input: "Synthetic successful input" }];
const bulkTools = [
  ["bulk_lookup_ip", "ips", ["8.8.8.8", "1.1.1.1", "8.8.8.8", "10.0.0.1"]],
  ["bulk_security_check", "ips", ["8.8.8.8", "1.1.1.1", "8.8.8.8", "10.0.0.1"]],
  ["bulk_parse_user_agent", "uaStrings", ["Synthetic-UA", "Retry-UA", "Synthetic-UA", "Invalid-UA"]],
];

function setup(t) {
  clearToolCacheForTests();
  const originalFetch = globalThis.fetch;
  const config = {
    IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS: "10000",
    IPGEOLOCATION_MCP_CACHE_TTL_MS: "300000",
    IPGEOLOCATION_MCP_CACHE_MAX_ENTRIES: "500",
  };
  const previous = Object.fromEntries(Object.keys(config).map(name => [name, process.env[name]]));
  Object.assign(process.env, config);
  globalThis.fetch = async () => { throw new Error("Unexpected network access blocked by cache hardening test"); };
  t.after(() => {
    globalThis.fetch = originalFetch;
    clearToolCacheForTests();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

const fetchCached = (key, fetchValue, force = false) => getCachedOrFetchValue(key, fetchValue, force, shouldCacheBulkResult);
const deferred = () => Promise.withResolvers();
function pendingLookup(t, key, family, force = false) {
  const gate = deferred(), controller = new AbortController();
  const request = { gate, controller, calls: 0, signal: undefined, promise: undefined };
  request.promise = withRequestSignal(controller.signal, () => getCachedOrFetchValue(key, () => {
    request.calls++;
    request.signal = getRequestSignal();
    return gate.promise;
  }, force, () => true, family));
  request.promise.catch(() => {});
  t.after(() => gate.resolve({ cleanup: true }));
  return request;
}
function structuredItem(item) {
  return withStructuredContent("bulk_lookup_ip", { ips: ["8.8.8.8"] }, {
    content: [{ type: "text", text: JSON.stringify([item]) }],
  }).structuredContent;
}

async function sdk(t, responder) {
  setup(t);
  const requests = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    assert.equal(url.origin, "https://api.ipgeolocation.io");
    const request = { path: url.pathname, body: JSON.parse(options.body) };
    requests.push(request);
    const response = await responder(request);
    return response instanceof Response ? response : new Response(JSON.stringify(response));
  };
  const server = createMcpServer({ apiKey: syntheticKey });
  const client = new Client({ name: "cache-hardening-local", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  await client.listTools();
  t.after(async () => { await client.close(); await server.close(); });
  return { requests, call: (name, args) => client.callTool({ name, arguments: args }) };
}

test("bulk cache classification matches actual structured errors for every HTTP error status", t => {
  setup(t);
  for (let status = 400; status <= 599; status++) {
    const item = { message: "Synthetic item failure", status };
    const expectedRetryable = status === 499 || status >= 500;
    const [error] = structuredItem(item).errors;
    assert.equal(error.status, status);
    assert.equal(error.retryable, expectedRetryable, `status ${status}`);
    assert.equal(shouldCacheBulkResult([item]), !error.retryable, `cache policy for ${status}`);
  }
});

test("bulk classification never infers a retryable item error from status-like data", t => {
  setup(t);
  for (const item of [
    { status: 503 }, { message: null, status: 503 }, { message: 1, status: 503 },
    { nested: { message: "Synthetic failure", status: 503 } },
    ...[undefined, null, "503", 503.5, 399, 600].map(status => ({ message: "Synthetic failure", status })),
  ]) {
    assert.equal(shouldCacheBulkResult([item]), true, JSON.stringify(item));
    assert.ok(structuredItem(item).errors.every(error => error.retryable === false));
  }
  for (const item of [null, [], 503, "failure"]) assert.equal(shouldCacheBulkResult([item]), false);
  for (const value of [null, undefined, {}, "failure", 503]) assert.equal(shouldCacheBulkResult(value), false);
  assert.equal(shouldCacheBulkResult([{ message: "", status: 503 }]), false, "empty string is still a defined error message");
  assert.equal(shouldCacheBulkResult([]), true);
});

test("successful and permanent/message-only arrays remain cached and explicit refresh replaces them", async t => {
  setup(t);
  const payloads = [success, [{ message: "Synthetic invalid input" }], ...[400, 401, 423, 429].map(status => [{ message: "Synthetic permanent failure", status }])];
  for (const [index, payload] of payloads.entries()) {
    let calls = 0;
    const key = `permanent-${index}`;
    const fetchValue = async () => { calls++; return payload; };
    assert.deepEqual(await fetchCached(key, fetchValue), payload);
    assert.deepEqual(await fetchCached(key, fetchValue), payload);
    assert.equal(calls, 1);
    const fresh = [{ generation: "fresh", index }];
    assert.deepEqual(await fetchCached(key, async () => { calls++; return fresh; }, true), fresh);
    assert.deepEqual(await fetchCached(key, fetchValue), fresh);
    assert.equal(calls, 2);
  }
  const nonbulk = { nested: transient };
  await getCachedOrFetchValue("nonbulk", async () => nonbulk);
  assert.equal(getCachedValue("nonbulk"), nonbulk, "default cache behavior for other callers is retained");
});

test("transient all-failure and mixed arrays are returned intact without cached storage or automatic retries", async t => {
  setup(t);
  for (const [index, payload] of [transient, [...success, ...transient, { message: "Synthetic bogon", status: 423 }]].entries()) {
    let calls = 0;
    const key = `transient-${index}`;
    const first = await fetchCached(key, async () => { calls++; return payload; });
    assert.equal(first, payload);
    assert.equal(getCachedValue(key), undefined);
    assert.equal(calls, 1);
    await Promise.resolve();
    assert.equal(calls, 1, "settling a mixed result must not schedule paid retries");
    assert.deepEqual(await fetchCached(key, async () => { calls++; return success; }), success);
    assert.deepEqual(await fetchCached(key, async () => { calls++; return transient; }), success);
    assert.equal(calls, 2);
  }
});

test("a completed transient force refresh evicts the previous success", async t => {
  setup(t);
  await fetchCached("refresh", async () => success);
  assert.equal(getCachedValue("refresh"), success);
  assert.equal(await fetchCached("refresh", async () => transient, true), transient);
  assert.equal(getCachedValue("refresh"), undefined);
  let nextCalls = 0;
  const next = [{ generation: "after-transient" }];
  assert.deepEqual(await fetchCached("refresh", async () => { nextCalls++; return next; }), next);
  assert.equal(nextCalls, 1);
});

test("concurrent identical transient lookups share pending work and later explicit calls can succeed", async t => {
  setup(t);
  const gate = deferred();
  let calls = 0;
  const fetchValue = () => { calls++; return gate.promise; };
  const first = fetchCached("pending", fetchValue);
  const joined = fetchCached("pending", fetchValue);
  assert.equal(calls, 1);
  gate.resolve(transient);
  const results = await Promise.all([first, joined]);
  assert.ok(results.every(result => result === transient));
  assert.equal(getCachedValue("pending"), undefined);
  await fetchCached("pending", async () => { calls++; return success; });
  await fetchCached("pending", fetchValue);
  assert.equal(calls, 2);
});

for (const family of [undefined, "cancelled-refresh-family"]) {
  const label = family ? "family" : "single key";
  for (const failure of [new Error("Synthetic refresh failure"), new DOMException("Synthetic upstream abort", "AbortError")]) {
    test(`failed refresh restores a shared normal lookup (${label}, ${failure.name})`, async t => {
      setup(t);
      const normal = pendingLookup(t, "failed-refresh", family);
      const refresh = pendingLookup(t, "failed-refresh", family, true);
      const refreshPeer = pendingLookup(t, "failed-refresh", family);
      refresh.gate.reject(failure);
      await assert.rejects(refresh.promise, error => error === failure);
      await assert.rejects(refreshPeer.promise, error => error === failure);
      const joined = pendingLookup(t, "failed-refresh", family);
      assert.equal(normal.calls + refresh.calls + refreshPeer.calls + joined.calls, 2);
      assert.equal(normal.signal.aborted, false);
      normal.gate.resolve(success);
      assert.equal(await normal.promise, success);
      assert.equal(await joined.promise, success);
      assert.equal(getCachedValue("failed-refresh"), success);
      for (const request of [normal, refresh, refreshPeer, joined]) assert.equal(getEventListeners(request.controller.signal, "abort").length, 0);
    });
  }

  for (const newestFirst of [false, true]) {
    test(`nested refresh failures restore the normal lookup (${label}, newest ${newestFirst ? "first" : "last"})`, async t => {
      setup(t);
      const normal = pendingLookup(t, "nested-failure", family);
      const older = pendingLookup(t, "nested-failure", family, true);
      const newer = pendingLookup(t, "nested-failure", family, true);
      for (const request of newestFirst ? [newer, older] : [older, newer]) {
        request.gate.reject(new Error("Synthetic refresh failure"));
        await assert.rejects(request.promise, /Synthetic refresh failure/);
      }
      const joined = pendingLookup(t, "nested-failure", family);
      assert.equal(normal.calls + older.calls + newer.calls + joined.calls, 3);
      normal.gate.resolve(success);
      assert.equal(await normal.promise, success);
      assert.equal(await joined.promise, success);
      assert.equal(getCachedValue("nested-failure"), success);
    });
  }

  for (const normalFinishesFirst of [false, true]) test(`a superseded refresh success prevents restored normal work from being ${normalFinishesFirst ? "cached" : "joined"} (${label})`, async t => {
    setup(t);
    const normal = pendingLookup(t, "late-refresh-success", family);
    const older = pendingLookup(t, "late-refresh-success", family, true);
    const newer = pendingLookup(t, "late-refresh-success", family, true);
    newer.gate.reject(new Error("Synthetic newest refresh failure"));
    await assert.rejects(newer.promise, /Synthetic newest refresh failure/);
    older.gate.resolve([{ generation: "newer than the normal lookup" }]);
    await older.promise;
    if (normalFinishesFirst) { normal.gate.resolve([{ stale: true }]); await normal.promise; }
    const replacement = pendingLookup(t, "late-refresh-success", family);
    assert.equal(replacement.calls, 1);
    if (!normalFinishesFirst) { normal.gate.resolve([{ stale: true }]); await normal.promise; }
    assert.equal(getCachedValue("late-refresh-success"), undefined);
    replacement.gate.resolve(success);
    assert.equal(await replacement.promise, success);
    assert.equal(getCachedValue("late-refresh-success"), success);
  });

  for (const finished of ["completed", "failed", "cancelled"]) {
    test(`failed refresh does not restore a ${finished} normal lookup (${label})`, async t => {
      setup(t);
      const normal = pendingLookup(t, "finished-normal", family);
      const refresh = pendingLookup(t, "finished-normal", family, true);
      if (finished === "completed") { normal.gate.resolve(success); await normal.promise; }
      else if (finished === "failed") { normal.gate.reject(new Error("Synthetic normal failure")); await assert.rejects(normal.promise); }
      else { normal.controller.abort(); await assert.rejects(normal.promise, /cancelled/i); }
      refresh.gate.reject(new Error("Synthetic refresh failure"));
      await assert.rejects(refresh.promise, /Synthetic refresh failure/);
      const replacement = pendingLookup(t, "finished-normal", family);
      assert.equal(replacement.calls, 1);
      replacement.gate.resolve(success);
      assert.equal(await replacement.promise, success);
    });
  }

  test(`a failed refresh restores normal work after one refresh subscriber cancels (${label})`, async t => {
    setup(t);
    const normal = pendingLookup(t, "failed-shared-refresh", family);
    const refresh = pendingLookup(t, "failed-shared-refresh", family, true);
    const peer = pendingLookup(t, "failed-shared-refresh", family);
    refresh.controller.abort();
    await assert.rejects(refresh.promise, /cancelled/i);
    assert.equal(refresh.signal.aborted, false);
    refresh.gate.reject(new Error("Synthetic shared refresh failure"));
    await assert.rejects(peer.promise, /Synthetic shared refresh failure/);
    const joined = pendingLookup(t, "failed-shared-refresh", family);
    assert.equal(joined.calls, 0);
    normal.controller.abort();
    await assert.rejects(normal.promise, /cancelled/i);
    assert.equal(normal.signal.aborted, false);
    normal.gate.resolve(success);
    assert.equal(await joined.promise, success);
    assert.equal(getCachedValue("failed-shared-refresh"), success);
  });

  test(`cancelled refresh restores an active normal request and caches its result (${label})`, async t => {
    setup(t);
    const normal = pendingLookup(t, "restore", family);
    const refresh = pendingLookup(t, "restore", family, true);
    refresh.controller.abort();
    await assert.rejects(refresh.promise, /cancelled/i);
    const joined = pendingLookup(t, "restore", family);
    assert.equal(normal.calls + refresh.calls + joined.calls, 2);
    assert.equal(normal.signal.aborted, false);
    assert.equal(refresh.signal.aborted, true);
    normal.gate.resolve(success);
    assert.equal(await normal.promise, success);
    assert.equal(await joined.promise, success);
    refresh.gate.resolve([{ stale: true }]);
    await Promise.resolve();
    assert.equal(getCachedValue("restore"), success);
    for (const request of [normal, refresh, joined]) assert.equal(getEventListeners(request.controller.signal, "abort").length, 0);
  });

  for (const cancelNewestFirst of [false, true]) {
    test(`nested refresh cancellations restore only live work (${label}, newest ${cancelNewestFirst ? "first" : "last"})`, async t => {
      setup(t);
      const normal = pendingLookup(t, "nested", family);
      const older = pendingLookup(t, "nested", family, true);
      const newer = pendingLookup(t, "nested", family, true);
      for (const request of cancelNewestFirst ? [newer, older] : [older, newer]) {
        request.controller.abort();
        await assert.rejects(request.promise, /cancelled/i);
      }
      const joined = pendingLookup(t, "nested", family);
      assert.equal(normal.calls + older.calls + newer.calls + joined.calls, 3);
      normal.gate.resolve(success);
      assert.equal(await normal.promise, success);
      assert.equal(await joined.promise, success);
      assert.equal(getCachedValue("nested"), success);
    });
  }

  test(`a cancelled refresh subscriber cannot displace its remaining live subscribers (${label})`, async t => {
    setup(t);
    const normal = pendingLookup(t, "subscribers", family);
    const refresh = pendingLookup(t, "subscribers", family, true);
    const peer = pendingLookup(t, "subscribers", family);
    refresh.controller.abort();
    await assert.rejects(refresh.promise, /cancelled/i);
    assert.equal(refresh.signal.aborted, false);
    const joined = pendingLookup(t, "subscribers", family);
    assert.equal(peer.calls + joined.calls, 0);
    peer.controller.abort();
    await assert.rejects(peer.promise, /cancelled/i);
    assert.equal(refresh.signal.aborted, false);
    joined.controller.abort();
    await assert.rejects(joined.promise, /cancelled/i);
    assert.equal(refresh.signal.aborted, true);
    const restored = pendingLookup(t, "subscribers", family);
    assert.equal(restored.calls, 0);
    normal.gate.resolve(success);
    assert.equal(await restored.promise, success);
    await normal.promise;
    for (const request of [normal, refresh, peer, joined, restored]) assert.equal(getEventListeners(request.controller.signal, "abort").length, 0);
  });

  for (const predecessorCompletes of [false, true]) {
    test(`cancelled refresh does not restore a ${predecessorCompletes ? "completed" : "cancelled"} predecessor (${label})`, async t => {
      setup(t);
      const normal = pendingLookup(t, "finished", family);
      const refresh = pendingLookup(t, "finished", family, true);
      if (predecessorCompletes) { normal.gate.resolve(success); await normal.promise; }
      else { normal.controller.abort(); await assert.rejects(normal.promise, /cancelled/i); }
      refresh.controller.abort();
      await assert.rejects(refresh.promise, /cancelled/i);
      const replacement = pendingLookup(t, "finished", family);
      assert.equal(replacement.calls, 1);
      assert.equal(getCachedValue("finished"), undefined);
      replacement.gate.resolve(success);
      assert.equal(await replacement.promise, success);
    });
  }

  test(`a superseded newer success prevents restoration of older data (${label})`, async t => {
    setup(t);
    const normal = pendingLookup(t, "successful-refresh", family);
    const older = pendingLookup(t, "successful-refresh", family, true);
    const newer = pendingLookup(t, "successful-refresh", family, true);
    older.gate.resolve([{ generation: 2 }]);
    await older.promise;
    newer.controller.abort();
    await assert.rejects(newer.promise, /cancelled/i);
    const replacement = pendingLookup(t, "successful-refresh", family);
    assert.equal(replacement.calls, 1);
    replacement.gate.resolve(success);
    await replacement.promise;
    normal.gate.resolve([{ stale: true }]);
    await normal.promise;
    assert.equal(getCachedValue("successful-refresh"), success);
  });

  test(`repeated cancelled refreshes retain the one active lookup (${label})`, async t => {
    setup(t);
    const normal = pendingLookup(t, "repeated", family);
    for (let i = 0; i < 128; i++) {
      const refresh = pendingLookup(t, "repeated", family, true);
      refresh.controller.abort();
      await assert.rejects(refresh.promise, /cancelled/i);
      refresh.gate.resolve([{ ignored: i }]);
      await Promise.resolve();
      assert.equal(getEventListeners(refresh.controller.signal, "abort").length, 0);
    }
    const joined = pendingLookup(t, "repeated", family);
    assert.equal(joined.calls, 0);
    normal.gate.resolve(success);
    assert.equal(await normal.promise, success);
    assert.equal(await joined.promise, success);
    assert.equal(getCachedValue("repeated"), success);
  });
}

for (const failed of [false, true]) for (const successAfterRestoration of [false, true]) {
  test(`newer sibling success prevents restored old work from being joined or cached (${successAfterRestoration ? "after" : "before"} ${failed ? "failure" : "cancellation"})`, async t => {
    setup(t);
    const normal = pendingLookup(t, "full", "siblings");
    const refresh = pendingLookup(t, "full", "siblings", true);
    if (successAfterRestoration) {
      if (failed) refresh.gate.reject(new Error("Synthetic refresh failure"));
      else refresh.controller.abort();
      await assert.rejects(refresh.promise, failed ? /Synthetic refresh failure/ : /cancelled/i);
    }
    const sibling = [{ generation: "new sibling" }];
    await getCachedOrFetchValue("projection", async () => sibling, false, () => true, "siblings");
    if (!successAfterRestoration) {
      if (failed) refresh.gate.reject(new Error("Synthetic refresh failure"));
      else refresh.controller.abort();
      await assert.rejects(refresh.promise, failed ? /Synthetic refresh failure/ : /cancelled/i);
    }
    const replacement = pendingLookup(t, "full", "siblings");
    assert.equal(replacement.calls, 1);
    normal.gate.resolve([{ stale: true }]);
    await normal.promise;
    assert.equal(getCachedValue("full"), undefined);
    assert.equal(getCachedValue("projection"), sibling);
    replacement.gate.resolve(success);
    assert.equal(await replacement.promise, success);
    assert.equal(getCachedValue("full"), success);
  });
}

for (const failed of [false, true]) test(`a newer sibling refresh remains a barrier when an older same-key refresh ${failed ? "fails" : "is cancelled"}`, async t => {
  setup(t);
  const normal = pendingLookup(t, "full", "siblings");
  const refresh = pendingLookup(t, "full", "siblings", true);
  const sibling = pendingLookup(t, "projection", "siblings", true);
  if (failed) refresh.gate.reject(new Error("Synthetic refresh failure"));
  else refresh.controller.abort();
  await assert.rejects(refresh.promise, failed ? /Synthetic refresh failure/ : /cancelled/i);
  const replacement = pendingLookup(t, "full", "siblings");
  assert.equal(replacement.calls, 1);
  normal.gate.resolve([{ stale: true }]);
  await normal.promise;
  assert.equal(getCachedValue("full"), undefined);
  sibling.gate.resolve([{ generation: "new sibling" }]);
  await sibling.promise;
  replacement.gate.resolve(success);
  await replacement.promise;
  assert.equal(getCachedValue("full"), success);
});

test("clearing pending work aborts every superseded active request and preserves later replacements", async t => {
  setup(t);
  const requests = [pendingLookup(t, "clear", "family"), pendingLookup(t, "clear", "family", true), pendingLookup(t, "clear", "family", true)];
  clearToolCacheForTests();
  assert.ok(requests.every(request => request.signal.aborted));
  await getCachedOrFetchValue("clear", async () => success, false, () => true, "family");
  for (const request of requests) { request.gate.resolve([{ stale: true }]); await request.promise; }
  assert.equal(getCachedValue("clear"), success);
});

for (const failed of [false, true]) test(`${failed ? "failed" : "cancelled"}-refresh restoration remains isolated by API key and cache key`, async t => {
  setup(t);
  const tenant = (name, fn) => withRuntimeConfig({ apiKey: `synthetic-cancel-tenant-${name}` }, fn);
  const first = tenant("a", () => pendingLookup(t, "shared", "family"));
  const refresh = tenant("a", () => pendingLookup(t, "shared", "family", true));
  const otherTenant = tenant("b", () => pendingLookup(t, "shared", "family"));
  const otherKey = tenant("a", () => pendingLookup(t, "other", "other-family"));
  if (failed) refresh.gate.reject(new Error("Synthetic refresh failure"));
  else refresh.controller.abort();
  await assert.rejects(refresh.promise, failed ? /Synthetic refresh failure/ : /cancelled/i);
  const restored = tenant("a", () => pendingLookup(t, "shared", "family"));
  const joinedTenant = tenant("b", () => pendingLookup(t, "shared", "family"));
  const joinedKey = tenant("a", () => pendingLookup(t, "other", "other-family"));
  assert.equal(restored.calls + joinedTenant.calls + joinedKey.calls, 0);
  for (const [request, value] of [[first, "a"], [otherTenant, "b"], [otherKey, "other"]]) request.gate.resolve({ value });
  assert.deepEqual(await restored.promise, { value: "a" });
  assert.deepEqual(await joinedTenant.promise, { value: "b" });
  assert.deepEqual(await joinedKey.promise, { value: "other" });
});

for (const olderTransient of [false, true]) {
  for (const olderFinishesFirst of [false, true]) {
    test(`forced ownership preserves latest ${olderTransient ? "success" : "transient"}, older finishes ${olderFinishesFirst ? "first" : "last"}`, async t => {
      setup(t);
      const oldGate = deferred(), newGate = deferred();
      const oldValue = olderTransient ? transient : [{ generation: "old" }];
      const newValue = olderTransient ? [{ generation: "new" }] : transient;
      let calls = 0;
      const older = fetchCached("race", () => { calls++; return oldGate.promise; }, true);
      const newer = fetchCached("race", () => { calls++; return newGate.promise; }, true);
      const joined = fetchCached("race", () => { throw new Error("must join latest pending request"); });
      if (olderFinishesFirst) {
        oldGate.resolve(oldValue); await older;
        assert.equal(getCachedValue("race"), undefined);
        newGate.resolve(newValue); await newer;
      } else {
        newGate.resolve(newValue); await newer;
        oldGate.resolve(oldValue); await older;
      }
      assert.equal(await joined, newValue);
      assert.equal(calls, 2);
      assert.equal(getCachedValue("race"), olderTransient ? newValue : undefined);
      const after = await fetchCached("race", async () => { calls++; return success; });
      assert.equal(after, olderTransient ? newValue : success);
      assert.equal(calls, olderTransient ? 2 : 3);
    });
  }
}

test("transient eviction remains scoped to its API key and preserves another tenant cache", async t => {
  setup(t);
  const asTenant = (tenant, callback) => withRuntimeConfig({ apiKey: `synthetic-tenant-${tenant}` }, callback);
  const valueA = [{ tenant: "a" }], valueB = [{ tenant: "b" }];
  await asTenant("a", () => fetchCached("same-key", async () => valueA));
  await asTenant("b", () => fetchCached("same-key", async () => valueB));
  await asTenant("a", () => fetchCached("same-key", async () => transient, true));
  assert.equal(asTenant("a", () => getCachedValue("same-key")), undefined);
  assert.equal(asTenant("b", () => getCachedValue("same-key")), valueB);
});

test("pending transient work is shared within each API key but never across keys", async t => {
  setup(t);
  const gateA = deferred(), gateB = deferred();
  let callsA = 0, callsB = 0;
  const asTenant = (tenant, callback) => withRuntimeConfig({ apiKey: `synthetic-pending-${tenant}` }, callback);
  const a = () => asTenant("a", () => fetchCached("same-key", () => { callsA++; return gateA.promise; }));
  const b = () => asTenant("b", () => fetchCached("same-key", () => { callsB++; return gateB.promise; }));
  const all = Promise.all([a(), a(), b(), b()]);
  assert.deepEqual([callsA, callsB], [1, 1]);
  const tenantB = [{ tenant: "b" }];
  gateA.resolve(transient); gateB.resolve(tenantB);
  const results = await all;
  assert.deepEqual(results, [transient, transient, tenantB, tenantB]);
  assert.equal(asTenant("a", () => getCachedValue("same-key")), undefined);
  assert.equal(asTenant("b", () => getCachedValue("same-key")), tenantB);
});

test("thrown shared requests clear pending work and a failed forced request retains prior success", async t => {
  setup(t);
  const gate = deferred();
  let calls = 0;
  const fetchValue = () => { calls++; return gate.promise; };
  const results = Promise.allSettled([fetchCached("thrown", fetchValue), fetchCached("thrown", fetchValue)]);
  gate.reject(new Error("Synthetic transport failure"));
  assert.ok((await results).every(result => result.status === "rejected"));
  assert.equal(calls, 1);
  await fetchCached("thrown", async () => { calls++; return success; });
  assert.equal(calls, 2);
  await assert.rejects(fetchCached("thrown", async () => { throw new Error("Synthetic forced transport failure"); }, true));
  assert.equal(getCachedValue("thrown"), success);
});

for (const [name, field, inputs] of bulkTools) {
  test(`${name} does not cache transient-only items and later explicit success is cached`, async t => {
    let recover = false;
    const { call, requests } = await sdk(t, () => recover ? [{ input: inputs[1] }] : transient);
    const args = { [field]: [inputs[1]] };
    const first = await call(name, args);
    assert.equal(first.isError, undefined);
    assert.equal(first.structuredContent.errors[0].retryable, true);
    assert.equal(requests.length, 1);
    recover = true;
    const next = await call(name, args);
    assert.deepEqual(next.structuredContent.errors, []);
    await call(name, args);
    assert.equal(requests.length, 2);
  });

  test(`${name} returns mixed success and errors unchanged and retries only explicitly submitted failures`, async t => {
    const payload = [{ input: inputs[0] }, { message: "Synthetic temporary failure", status: 503 }, { input: inputs[2] }, { message: "Synthetic reserved input", status: 423 }];
    const { call, requests } = await sdk(t, request => request.body[field].length === 1 ? [{ input: inputs[1] }] : payload);
    const first = await call(name, { [field]: inputs });
    assert.equal(first.isError, undefined);
    assert.deepEqual(first.structuredContent.items, payload);
    assert.deepEqual(first.structuredContent.errors.map(error => [error.input_index, error.input, error.retryable]), [[1, inputs[1], true], [3, inputs[3], false]]);
    assert.equal(requests.length, 1);
    const failedOnly = first.structuredContent.errors.filter(error => error.retryable).map(error => error.input);
    const retry = await call(name, { [field]: failedOnly });
    assert.deepEqual(requests.map(request => request.body[field]), [inputs, [inputs[1]]]);
    assert.deepEqual(retry.structuredContent.errors, []);
    assert.equal(requests.length, 2);
  });

  test(`${name} keeps message-only, 423 and 429 item errors cached`, async t => {
    let payload;
    const { call, requests } = await sdk(t, () => payload);
    for (const status of [undefined, 423, 429]) {
      clearToolCacheForTests();
      payload = [{ message: "Synthetic permanent failure", ...(status === undefined ? {} : { status }) }];
      const before = requests.length;
      const first = await call(name, { [field]: [inputs[0]] });
      const second = await call(name, { [field]: [inputs[0]] });
      assert.equal(first.structuredContent.errors[0].retryable, false);
      assert.deepEqual(second.structuredContent, first.structuredContent);
      assert.equal(requests.length, before + 1);
    }
  });

  test(`${name} retains paginated mixed snapshots with zero page refetches after lookup cache rejection`, async t => {
    const payload = [{ input: inputs[0], notes: '"\\\n😀界'.repeat(3000) }, { message: "Synthetic temporary failure", status: 503 }];
    const { call, requests } = await sdk(t, request => request.body[field].length === 1 ? [{ input: inputs[1] }] : payload);
    const first = await call(name, { [field]: inputs.slice(0, 2) });
    assert.equal(first.isError, undefined);
    const firstPage = first.structuredContent.page;
    assert.ok(firstPage.next_cursor);
    const replay = await call("get_cached_result", { cursor: firstPage.cursor });
    assert.equal(replay.structuredContent.page.json_fragment, firstPage.json_fragment);
    let result = first, json = "", count = 0;
    for (;;) {
      const page = result.structuredContent.page;
      assert.equal(page.source_tool, name);
      assert.equal(page.format, "structuredContent_json");
      assert.equal(page.offset, json.length);
      assert.equal(page.total_chars, firstPage.total_chars);
      assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 10000);
      json += page.json_fragment;
      assert.ok(++count < 200);
      if (!page.next_cursor) break;
      result = await call("get_cached_result", { cursor: page.next_cursor });
      assert.equal(result.isError, undefined);
    }
    assert.equal(json.length, firstPage.total_chars);
    const recovered = JSON.parse(json);
    assert.deepEqual(recovered.items, payload);
    assert.equal(recovered.errors[0].input_index, 1);
    assert.equal(recovered.errors[0].input, inputs[1]);
    assert.equal(recovered.errors[0].retryable, true);
    assert.equal(requests.length, 1, "page reads and replays must never retry paid successful rows");
    await call(name, { [field]: [inputs[1]], force_refresh: true });
    assert.equal(requests.length, 2);
    const after = await call("get_cached_result", { cursor: firstPage.cursor });
    assert.equal(after.structuredContent.page.json_fragment, firstPage.json_fragment);
    assert.equal(requests.length, 2, "a later explicit failed-only lookup must not invalidate old snapshot reads");
  });
}
