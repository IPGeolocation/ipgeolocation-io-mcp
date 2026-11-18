import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// SERVER_RUNTIME_ROOT is the directory containing the compiled index.js.
const runtimeRoot = resolve(process.env.SERVER_RUNTIME_ROOT ?? fileURLToPath(new URL("../dist", import.meta.url)));
const { createMcpServer } = await import(pathToFileURL(`${runtimeRoot}/index.js`).href);
const { clearToolCacheForTests } = await import(pathToFileURL(`${runtimeRoot}/tools/cache.js`).href);
const nativeFetch = globalThis.fetch;
const syntheticKey = "readiness-regression-synthetic-key";
const json = value => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const turn = () => new Promise(resolveTurn => setImmediate(resolveTurn));
const deferred = () => Promise.withResolvers();
const base = generation => ({
  ip: "8.8.8.8", generation,
  location: { city: `Generation ${generation}` },
  company: { name: "Synthetic Company" }, asn: { as_number: "AS1" },
  network: { route: "8.8.8.0/24" }, currency: { code: "TST" },
  country_metadata: { tld: ".test" }, security: { threat_score: generation, is_vpn: generation % 2 === 0 },
  abuse: { emails: ["abuse@example.test"] }, user_agent_string: "Synthetic-UA",
  astronomy: [{ date: "2026-01-01" }],
});
const projected = (generation, request) => request.url.searchParams.get("fields") === "security.is_vpn"
  ? { ip: "8.8.8.8", security: { is_vpn: generation % 2 === 0 } } : base(generation);

async function setup(t, responder) {
  clearToolCacheForTests();
  const previousFetch = globalThis.fetch, previousNow = Date.now;
  const settings = {
    IPGEOLOCATION_REQUEST_TIMEOUT_MS: "10000", IPGEOLOCATION_MCP_CACHE_TTL_MS: "300000",
    IPGEOLOCATION_MCP_CACHE_MAX_ENTRIES: "500", IPGEOLOCATION_MCP_MAX_RESULT_ITEMS: "250",
    IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS: "200000", IPGEOLOCATION_MCP_MAX_ERROR_CHARS: "4000",
  };
  const previous = Object.fromEntries(Object.keys(settings).map(name => [name, process.env[name]]));
  Object.assign(process.env, settings);
  const requests = [], sessions = [];
  globalThis.fetch = async (input, options = {}) => {
    const request = { url: new URL(input), options, body: options.body ? JSON.parse(options.body) : undefined };
    assert.equal(request.url.origin, "https://api.ipgeolocation.io", "all external network access is blocked");
    requests.push(request);
    if (!responder) throw new Error("Unexpected upstream access blocked by readiness regression");
    const result = await responder(request, requests.length);
    return result instanceof Response ? result : json(result);
  };
  t.after(async () => {
    for (const { client, server } of sessions) { await client.close(); await server.close(); }
    clearToolCacheForTests();
    globalThis.fetch = previousFetch; Date.now = previousNow;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await turn();
  });
  async function session(apiKey = syntheticKey) {
    const server = createMcpServer({ apiKey });
    const client = new Client({ name: "readiness-regression", version: "1.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b); await client.connect(a); await client.listTools();
    sessions.push({ client, server });
    return {
      client,
      call: (name, args = {}, options) => client.callTool({ name, arguments: args }, undefined, options),
    };
  }
  return { requests, session };
}

const cachedSingles = [
  ["lookup_ip", { ip: "8.8.8.8" }],
  ["lookup_ip", { ip: "8.8.8.8", fields: "location.city" }],
  ["lookup_ip", { ip: "8.8.8.8", include: "security", fields: "security.is_vpn" }],
  ["lookup_company", { ip: "8.8.8.8" }], ["lookup_currency", { ip: "8.8.8.8" }],
  ["lookup_network", { ip: "8.8.8.8" }], ["check_security", { ip: "8.8.8.8", fields: "security.is_vpn" }],
  ["lookup_asn", { asn: "AS1", fields: "asn.as_number" }],
  ["get_abuse_contact", { ip: "8.8.8.8", fields: "abuse.emails" }],
  ["parse_user_agent", { uaString: "Synthetic-UA" }],
  ["get_astronomy_time_series", { ip: "8.8.8.8", dateStart: "2026-01-01", dateEnd: "2026-01-01" }],
];
for (const [name, args] of cachedSingles) {
  for (const bad of [null, [], "invalid single root"]) {
    test(`${name} ${JSON.stringify(args)} rejects ${JSON.stringify(bad)} before projection/cache and recovers`, async t => {
      const { requests, session } = await setup(t, (_request, count) => count === 1 ? bad : base(2));
      const { call } = await session();
      const first = await call(name, args);
      assert.equal(first.isError, true, "a malformed upstream root must not become an empty projected success");
      assert.equal(first.structuredContent.error.source, "mcp_server");
      assert.equal(requests.length, 1, "a malformed response must never trigger an automatic paid retry");
      const second = await call(name, args);
      assert.equal(second.isError, undefined, "a valid explicit retry must not reuse the malformed body");
      assert.equal(requests.length, 2);
      assert.deepEqual((await call(name, args)).structuredContent, second.structuredContent);
      assert.equal(requests.length, 2, "a recovered valid result must remain cacheable");
    });
  }
}

const bulkCases = [
  ["bulk_lookup_ip", "ips", ["8.8.8.8", "1.1.1.1", "8.8.8.8"]],
  ["bulk_security_check", "ips", ["8.8.8.8", "1.1.1.1", "8.8.8.8"]],
  ["bulk_parse_user_agent", "uaStrings", ["Synthetic-UA", "Other-UA", "Synthetic-UA"]],
];
const malformedBulk = [
  ["object root", () => ({ message: "Malformed bulk root" })],
  ["null root", () => null], ["empty array", () => []],
  ["missing row", good => good.slice(0, -1)], ["extra row", good => [...good, good[0]]],
  ["null row", good => [good[0], null, good[2]]],
  ["array row", good => [good[0], [], good[2]]],
  ["scalar row", good => [good[0], "malformed row", good[2]]],
];
for (const [name, field, inputs] of bulkCases) {
  for (const [label, bad] of malformedBulk) {
    test(`${name} rejects ${label} before caching and recovers in exact duplicate order`, async t => {
      const good = inputs.map(input => field === "ips" ? { ip: input, security: { is_vpn: false } } : { user_agent_string: input });
      const { requests, session } = await setup(t, (_request, count) => count === 1 ? bad(good) : good);
      const { call } = await session();
      const first = await call(name, { [field]: inputs });
      assert.equal(first.isError, true);
      assert.equal(first.structuredContent.error.source, "mcp_server");
      assert.equal(requests.length, 1);
      const next = await call(name, { [field]: inputs });
      assert.equal(next.isError, undefined);
      assert.deepEqual(next.structuredContent.items, good);
      assert.deepEqual(next.structuredContent.errors, []);
      assert.equal(requests.length, 2);
      assert.deepEqual((await call(name, { [field]: inputs })).structuredContent, next.structuredContent);
      assert.equal(requests.length, 2);
    });
  }
}

test("valid partial roots and permanent/message-only bulk errors stay usable", async t => {
  const { requests, session } = await setup(t, request => request.body?.ips
    ? [{ ip: request.body.ips[0] }, { message: "Synthetic private input", status: 423 }, { message: "Synthetic unsupported input" }]
    : { ip: "8.8.8.8", asn: { as_number: "AS1" } });
  const { call } = await session();
  const ownership = await call("lookup_company", { ip: "8.8.8.8" });
  assert.equal(ownership.isError, undefined);
  assert.deepEqual(ownership.structuredContent.data, { asn: { as_number: "AS1" } });
  const args = { ips: ["8.8.8.8", "10.0.0.1", "bad-input"] };
  const mixed = await call("bulk_lookup_ip", args);
  assert.equal(mixed.isError, undefined);
  assert.deepEqual(mixed.structuredContent.errors.map(error => [error.input_index, error.input, error.retryable]), [[1, "10.0.0.1", false], [2, "bad-input", false]]);
  const before = requests.length;
  assert.deepEqual((await call("bulk_lookup_ip", args)).structuredContent, mixed.structuredContent);
  assert.equal(requests.length, before);
});

test("warm projections expire with their source instead of adding a fresh five-minute TTL", async t => {
  const { requests, session } = await setup(t, (request, count) => projected(count, request));
  const { call } = await session();
  let now = 1_000_000; Date.now = () => now;
  const full = { ip: "8.8.8.8", include: "security" };
  await call("lookup_ip", full);
  now += 299_999;
  const warm = await call("lookup_ip", { ...full, fields: "security.is_vpn" });
  assert.equal(warm.structuredContent.data.security.is_vpn, false); assert.equal(requests.length, 1);
  now++;
  const expired = await call("lookup_ip", { ...full, fields: "security.is_vpn" });
  assert.equal(expired.isError, undefined);
  assert.equal(expired.structuredContent.data.security.is_vpn, true);
  assert.equal(requests.length, 2, "the projected data must not outlive the original source TTL");
});

for (const coldTarget of [false, true]) {
  test(`full force refresh replaces ${coldTarget ? "cold targeted" : "warm derived"} sibling projections`, async t => {
    const { requests, session } = await setup(t, (request, count) => projected(count, request));
    const { call } = await session();
    const full = { ip: "8.8.8.8", include: "security" }, target = { ...full, fields: "security.is_vpn" };
    if (!coldTarget) await call("lookup_ip", full);
    assert.equal((await call("lookup_ip", target)).structuredContent.data.security.is_vpn, false);
    assert.equal(requests.length, 1);
    assert.equal((await call("lookup_ip", { ...full, force_refresh: true })).structuredContent.data.security.is_vpn, true);
    for (const fields of ["security.is_vpn", "security.is_vpn,security.threat_score"]) {
      assert.equal((await call("lookup_ip", { ...full, fields })).structuredContent.data.security.is_vpn, true);
    }
    assert.equal(requests.length, 2, "a refreshed full result must satisfy sibling projections without another API request");
  });
}

test("a forced target replaces the older full snapshot and stays fresh on its next read", async t => {
  const { requests, session } = await setup(t, (request, count) => projected(count, request));
  const { call } = await session();
  const full = { ip: "8.8.8.8", include: "security" }, target = { ...full, fields: "security.is_vpn" };
  await call("lookup_ip", full);
  const forced = await call("lookup_ip", { ...target, force_refresh: true });
  assert.equal(forced.structuredContent.data.security.is_vpn, true);
  assert.equal((await call("lookup_ip", target)).structuredContent.data.security.is_vpn, true);
  assert.equal(requests.length, 2, "the forced target must not fall back to the old full snapshot");
  const nextFull = await call("lookup_ip", full);
  assert.equal(nextFull.structuredContent.data.generation, 3);
  assert.equal(requests.length, 3, "the old full snapshot must have been invalidated");
  const nextTarget = await call("lookup_ip", target);
  assert.equal(nextTarget.structuredContent.data.security.is_vpn, nextFull.structuredContent.data.security.is_vpn);
  assert.equal(requests.length, 3);
});

test("failed forced projection preserves earlier valid siblings", async t => {
  const { requests, session } = await setup(t, (request, count) => {
    if (count === 2) throw new Error("Synthetic forced upstream failure");
    return projected(count, request);
  });
  const { call } = await session();
  const full = { ip: "8.8.8.8", include: "security" };
  const first = await call("lookup_ip", full);
  assert.equal((await call("lookup_ip", { ...full, fields: "security.is_vpn", force_refresh: true })).isError, true);
  assert.deepEqual((await call("lookup_ip", full)).structuredContent, first.structuredContent);
  assert.equal((await call("lookup_ip", { ...full, fields: "security.is_vpn" })).structuredContent.data.security.is_vpn, false);
  assert.equal(requests.length, 2, "a failed refresh must not discard a previous usable full snapshot");
});

for (const olderIsFull of [false, true]) {
  for (const olderFinishesFirst of [false, true]) {
    test(`cross-variant refresh: older ${olderIsFull ? "full" : "target"} finishes ${olderFinishesFirst ? "first" : "last"}`, async t => {
      const oldGate = deferred(), freshGate = deferred(), oldStarted = deferred(), freshStarted = deferred();
      t.after(() => { oldGate.resolve(); freshGate.resolve(); });
      const { requests, session } = await setup(t, async (request, count) => {
        if (count === 1) { oldStarted.resolve(); await oldGate.promise; }
        if (count === 2) { freshStarted.resolve(); await freshGate.promise; }
        return projected(count, request);
      });
      const { call } = await session();
      const full = { ip: "8.8.8.8", include: "security" }, target = { ...full, fields: "security.is_vpn" };
      const older = call("lookup_ip", olderIsFull ? full : target); await oldStarted.promise;
      const newer = call("lookup_ip", { ...(olderIsFull ? target : full), force_refresh: true }); await freshStarted.promise;
      if (olderFinishesFirst) { oldGate.resolve(); await older; freshGate.resolve(); await newer; }
      else { freshGate.resolve(); await newer; oldGate.resolve(); await older; }
      if (olderIsFull) {
        assert.equal((await call("lookup_ip", target)).structuredContent.data.security.is_vpn, true);
        assert.equal(requests.length, 2);
        const nextFull = await call("lookup_ip", full);
        assert.equal(nextFull.structuredContent.data.generation, 3, "an older full completion must not repopulate the cache");
        assert.equal(requests.length, 3);
      } else {
        assert.equal((await call("lookup_ip", target)).structuredContent.data.security.is_vpn, true, "the old target must not mask the refreshed full result");
        assert.equal(requests.length, 2);
      }
    });
  }
}

test("family refresh preserves previously issued pagination snapshots", async t => {
  const notes = '😀界"\\\n'.repeat(2500);
  const original = { ...base(1), notes };
  const { requests, session } = await setup(t, (request, count) => count === 1 ? original : projected(count, request));
  process.env.IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS = "10000";
  const { call } = await session();
  const full = { ip: "8.8.8.8", include: "security" };
  const first = await call("lookup_ip", full);
  assert.ok(first.structuredContent.page?.next_cursor);
  assert.equal((await call("lookup_ip", { ...full, fields: "security.is_vpn", force_refresh: true })).isError, undefined);
  let result = await call("get_cached_result", { cursor: first.structuredContent.page.cursor });
  let combined = "", pages = 0;
  for (;;) {
    assert.equal(result.isError, undefined, "a lookup refresh must not delete an already issued page snapshot");
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 10000);
    const page = result.structuredContent.page;
    assert.equal(page.offset, combined.length); combined += page.json_fragment;
    assert.ok(++pages < 100);
    if (!page.next_cursor) break;
    result = await call("get_cached_result", { cursor: page.next_cursor });
  }
  assert.deepEqual(JSON.parse(combined), { data: original });
  assert.equal(requests.length, 2, "retrieving the old snapshot must never refetch upstream data");
});

test("family invalidation remains scoped to the configured API key", async t => {
  const counts = new Map();
  const { requests, session } = await setup(t, request => {
    const key = new Headers(request.options.headers).get("x-ipgeolocation-api-key");
    const generation = (counts.get(key) ?? 0) + 1; counts.set(key, generation);
    return projected(generation, request);
  });
  const a = await session("readiness-tenant-a-synthetic"), b = await session("readiness-tenant-b-synthetic");
  const full = { ip: "8.8.8.8", include: "security" }, target = { ...full, fields: "security.is_vpn" };
  await a.call("lookup_ip", full);
  const beforeB = await b.call("lookup_ip", full);
  await b.call("lookup_ip", target);
  assert.equal((await a.call("lookup_ip", { ...full, force_refresh: true })).structuredContent.data.security.is_vpn, true);
  assert.deepEqual((await b.call("lookup_ip", full)).structuredContent, beforeB.structuredContent);
  assert.equal((await b.call("lookup_ip", target)).structuredContent.data.security.is_vpn, false);
  assert.equal(requests.length, 3, "one key's forced refresh must not evict another key's usable family");
});

async function waitFor(predicate, message, limit = 750) {
  const start = performance.now();
  while (!predicate() && performance.now() - start < limit) await delay(5);
  assert.ok(predicate(), message);
}

async function loopback(t) {
  const entries = [], started = deferred();
  const upstream = createServer((request, response) => {
    request.resume();
    const entry = { request, response }; entries.push(entry);
    response.writeHead(200, { "content-type": "application/json" }); response.write("{");
    started.resolve(entry);
    if (entries.length > 1) response.end(`"ip":"8.8.8.8","generation":${entries.length}}`);
  });
  await new Promise(resolveListen => upstream.listen(0, "127.0.0.1", resolveListen));
  t.after(async () => { upstream.closeAllConnections(); await new Promise(resolveClose => upstream.close(resolveClose)); });
  const signals = [];
  globalThis.fetch = (input, options = {}) => {
    assert.equal(new URL(input).origin, "https://api.ipgeolocation.io");
    signals.push(options.signal);
    return nativeFetch(`http://127.0.0.1:${upstream.address().port}${new URL(input).pathname}`, options);
  };
  return { entries, started, signals };
}

for (const [name, args] of [
  ["get_timezone", { tz: "Etc/UTC" }],
  ["convert_timezone", { tz_from: "Etc/UTC", tz_to: "Asia/Karachi" }],
  ["get_astronomy", { lat: "0", long: "0" }], ["get_my_ip", {}],
]) {
  test(`${name} cancellation aborts native HTTP response-body work`, async t => {
    const { session } = await setup(t);
    const { call } = await session();
    const { started, signals } = await loopback(t);
    const controller = new AbortController();
    const pending = call(name, args, { signal: controller.signal });
    const outcome = Promise.allSettled([pending]);
    const { response } = await started.promise;
    controller.abort(new Error("Synthetic user cancellation"));
    assert.equal((await outcome)[0].status, "rejected");
    await waitFor(() => signals[0].aborted, "MCP cancellation must abort native fetch promptly instead of waiting for its deadline");
    await waitFor(() => response.destroyed, "cancellation must close the unfinished upstream response");
  });
}

test("one cancelled subscriber preserves another same-key session's shared native request", async t => {
  const { session } = await setup(t);
  const a = await session(), b = await session();
  const { entries, started, signals } = await loopback(t);
  const controller = new AbortController(), args = { ip: "8.8.8.8" };
  const first = a.call("lookup_ip", args, { signal: controller.signal }), firstOutcome = Promise.allSettled([first]);
  const { response } = await started.promise;
  const second = b.call("lookup_ip", args);
  await b.client.ping(); await turn();
  assert.equal(entries.length, 1);
  controller.abort(new Error("Synthetic first subscriber cancellation"));
  assert.equal((await firstOutcome)[0].status, "rejected");
  await turn(); await turn();
  assert.equal(signals[0].aborted, false, "a remaining live subscriber owns the shared request");
  response.end('"ip":"8.8.8.8","generation":1}');
  assert.equal((await second).structuredContent.data.generation, 1);
  assert.equal((await b.call("lookup_ip", args)).structuredContent.data.generation, 1);
  assert.equal(entries.length, 1);
});

test("all cancelled subscribers abort shared work and an immediate new caller fetches fresh data", async t => {
  const { session } = await setup(t);
  const a = await session(), b = await session(), c = await session();
  const { entries, started, signals } = await loopback(t);
  const ca = new AbortController(), cb = new AbortController(), args = { ip: "8.8.8.8" };
  const first = a.call("lookup_ip", args, { signal: ca.signal }), firstOutcome = Promise.allSettled([first]);
  await started.promise;
  const second = b.call("lookup_ip", args, { signal: cb.signal }), secondOutcome = Promise.allSettled([second]);
  await b.client.ping(); await turn();
  assert.equal(entries.length, 1);
  let fresh;
  // Start the replacement while the aborted shared operation may still be unwinding.
  signals[0].addEventListener("abort", () => { fresh = c.call("lookup_ip", args); fresh.catch(() => {}); }, { once: true });
  ca.abort(new Error("Synthetic subscriber A cancellation")); cb.abort(new Error("Synthetic subscriber B cancellation"));
  assert.equal((await firstOutcome)[0].status, "rejected"); assert.equal((await secondOutcome)[0].status, "rejected");
  await waitFor(() => signals[0].aborted, "the last cancelled subscriber must abort the shared fetch");
  const recovered = await fresh;
  assert.equal(recovered.isError, undefined, "a new caller must not join the doomed cancelled promise");
  assert.equal(recovered.structuredContent.data.generation, 2);
  assert.equal(entries.length, 2);
  assert.equal((await c.call("lookup_ip", args)).structuredContent.data.generation, 2);
  assert.equal(entries.length, 2);
});

test("an upstream error cut never splits an astral character in structured or visible text", async t => {
  const { session } = await setup(t, () => new Response(JSON.stringify({ message: `${"a".repeat(3999)}😀tail` }), { status: 503 }));
  const { call } = await session();
  for (const limit of ["200000", "10000"]) {
    process.env.IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS = limit;
    const result = await call("lookup_ip", { ip: "8.8.8.8" });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.status, 503);
    assert.equal(result.structuredContent.error.source, "ipgeolocation_api");
    assert.equal(result.structuredContent.error.retryable, true);
    assert.ok(result.structuredContent.error.message.isWellFormed());
    assert.ok(result.content[0].text.isWellFormed());
    assert.ok(Buffer.byteLength(JSON.stringify(result), "utf8") <= Number(limit));
  }
});

for (const [name, args] of [
  ["lookup_ip", { ip: "8.8.8.8" }], ["lookup_ip", { ip: "8.8.8.8", include: "security" }],
  ["bulk_lookup_ip", { ips: ["8.8.8.8"] }],
  ["get_astronomy_time_series", { ip: "8.8.8.8", dateStart: "2026-01-01", dateEnd: "2026-01-01" }],
]) {
  test(`${name} ${JSON.stringify(args)} shares omitted/en aliases but isolates other languages`, async t => {
    const { requests, session } = await setup(t, request => request.body?.ips ? request.body.ips.map(ip => ({ ...base(1), ip })) : base(1));
    const { call } = await session();
    const omitted = await call(name, args);
    assert.equal(omitted.isError, undefined);
    assert.equal(requests[0].url.searchParams.has("lang"), false, "key canonicalization must not change the omitted outbound parameter");
    for (const lang of ["en", " EN "]) assert.deepEqual((await call(name, { ...args, lang })).structuredContent, omitted.structuredContent);
    assert.equal(requests.length, 1);
    assert.equal((await call(name, { ...args, lang: "fr" })).isError, undefined);
    assert.equal(requests.length, 2);
    assert.equal((await call(name, { ...args, lang: "en", force_refresh: true })).isError, undefined);
    assert.equal(requests.length, 3, "force_refresh must still start an upstream request for a default-language alias");
    assert.equal((await call(name, { ...args, lang: "fr" })).isError, undefined);
    assert.equal(requests.length, 3, "refreshing English must preserve the separately cached non-English result");
  });
}

test("explicit-English base data serves all default-language convenience tools", async t => {
  const { requests, session } = await setup(t, () => base(1));
  const { call } = await session();
  assert.equal((await call("lookup_ip", { ip: "8.8.8.8", lang: "en" })).isError, undefined);
  for (const name of ["lookup_company", "lookup_currency", "lookup_network"]) assert.equal((await call(name, { ip: "8.8.8.8" })).isError, undefined);
  assert.equal(requests.length, 1);
});
