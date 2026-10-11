import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { createMcpServer } from "../dist/index.js";
import { clearToolCacheForTests } from "../dist/tools/cache.js";
import { formatToolResult } from "../dist/tools/response.js";
import { applyFieldsAndExcludes } from "../dist/tools/projection.js";
import { withRuntimeConfig } from "../dist/config.js";
import { getIpGeolocation, getIpGeolocationBulk } from "../dist/client.js";

const fakeKey = 'regression-key/with+quotes"and\\slashes';
const json = data => new Response(JSON.stringify(data));
async function sdk(t, responder) {
  clearToolCacheForTests();
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const request = { url: new URL(url), options, body: options.body ? JSON.parse(options.body) : undefined };
    requests.push(request);
    const response = await responder(request);
    return response instanceof Response ? response : json(response);
  };
  const server = createMcpServer({ apiKey: fakeKey });
  const client = new Client({ name: "regression-test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    globalThis.fetch = originalFetch;
    clearToolCacheForTests();
    await client.close();
    await server.close();
  });
  await server.connect(b);
  await client.connect(a);
  return { client, requests, call: (name, args = {}) => client.callTool({ name, arguments: args }) };
}

test("redaction preserves valid JSON, escaping, object keys, and sensitive field values", () => {
  const source = JSON.parse('{"__proto__":{"safe":true},"apiKey":"not configured and quoted \\\"value\\\"","x-ipgeolocation-api-key":"other header value","nested":[null,true,42,"Browser (apiKey=\\\"quoted-value\\\") 😀\\n"]}');
  source[fakeKey] = `echo ${fakeKey} ${encodeURIComponent(fakeKey)}`;
  const text = withRuntimeConfig({ apiKey: fakeKey }, () => formatToolResult(source));
  const data = JSON.parse(text);
  assert.deepEqual(data.__proto__, { safe: true });
  assert.equal(Object.getPrototypeOf(data), Object.prototype);
  assert.equal(data.apiKey, "[REDACTED_API_KEY]");
  assert.equal(data["x-ipgeolocation-api-key"], "[REDACTED_API_KEY]");
  assert.equal(data.nested[3], 'Browser (apiKey="[REDACTED_API_KEY]") 😀\n');
  assert.ok(Object.hasOwn(data, "[REDACTED_API_KEY]"));
  assert.ok(!text.includes("quoted-value") && !text.includes("not configured"));
  assert.ok(!text.includes(fakeKey) && !text.includes(encodeURIComponent(fakeKey)));
  assert.equal(withRuntimeConfig({ apiKey: fakeKey }, () => formatToolResult(data)), text, "redaction is idempotent");
});

test("SDK returns quoted user-agent and WHOIS text as valid redacted success JSON", async t => {
  const { call, requests } = await sdk(t, () => ({ text: 'Browser (apiKey="quoted-value") 😀\\\n' }));
  for (const [name, args] of [["parse_user_agent", { uaString: "Browser" }], ["lookup_asn", { asn: "AS1", include: "whois_response" }]]) {
    const result = await call(name, args);
    assert.equal(result.isError, undefined);
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent.data);
    assert.equal(result.structuredContent.data.text, 'Browser (apiKey="[REDACTED_API_KEY]") 😀\\\n');
  }
  assert.equal(requests.length, 2);
});

test("cached pages recover quoted bulk errors and secrets without another API request", async t => {
  const oldLimit = process.env.IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS;
  process.env.IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS = "10000";
  t.after(() => oldLimit === undefined ? delete process.env.IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS : process.env.IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS = oldLimit);
  const large = { ip: "8.8.8.8", text: `apiKey="unknown-secret" ${fakeKey} 😀\\\n`.repeat(1200) };
  const { call, requests } = await sdk(t, () => [large, { message: 'Invalid apiKey="bad-value"', status: 400 }]);
  let result = await call("bulk_lookup_ip", { ips: ["8.8.8.8", 'bad apiKey="quoted-value"'] });
  let joined = "";
  let pages = 0;
  do {
    assert.equal(result.isError, undefined);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 10000);
    const page = result.structuredContent.page;
    assert.equal(page.offset, joined.length);
    joined += page.json_fragment;
    assert.ok(++pages < 200);
    if (!page.next_cursor) break;
    result = await call("get_cached_result", { cursor: page.next_cursor });
  } while (true);
  const recovered = JSON.parse(joined);
  assert.equal(recovered.errors[0].input, 'bad apiKey="[REDACTED_API_KEY]"');
  assert.equal(recovered.errors[0].status, 400);
  assert.deepEqual(recovered.items[0], withRuntimeConfig({ apiKey: fakeKey }, () => JSON.parse(formatToolResult(large))));
  assert.ok(!joined.includes("unknown-secret") && !joined.includes("quoted-value") && !joined.includes(fakeKey));
  assert.ok(pages > 1);
  assert.equal(requests.length, 1);
});

for (const name of ["bulk_lookup_ip", "bulk_security_check"]) {
  test(`${name} keeps batch input boundaries in cache keys and item errors`, async t => {
    const { call, requests } = await sdk(t, ({ body }) => body.ips.map(ip => ip.includes(",") ? { message: "Invalid IP", status: 400 } : { ip }));
    const firstInputs = ["8.8.8.8,1.1.1.1", "9.9.9.9"];
    const secondInputs = ["8.8.8.8", "1.1.1.1,9.9.9.9"];
    const first = await call(name, { ips: firstInputs });
    const second = await call(name, { ips: secondInputs });
    assert.equal(first.structuredContent.errors[0].input_index, 0);
    assert.equal(second.structuredContent.errors[0].input_index, 1);
    assert.equal(second.structuredContent.errors[0].input, secondInputs[1]);
    assert.equal(second.structuredContent.items[0].ip, "8.8.8.8");
    assert.equal(requests.length, 2);
    await call(name, { ips: secondInputs });
    assert.equal(requests.length, 2, "identical batches still use the cache");
  });
}

test("cache keys preserve parameter boundaries and distinguish omitted selectors from text", async t => {
  const { call, requests } = await sdk(t, () => ({ ip: "8.8.8.8", asn: { as_number: "AS1" }, astronomy: [] }));
  for (const [name, first, second] of [
    ["lookup_ip", { ip: "a|lang=b", lang: "c" }, { ip: "a", lang: "b|lang=c" }],
    ["lookup_asn", { ip: "a|include=routes", include: "peers" }, { ip: "a", include: "routes|include=peers" }],
    ["get_astronomy_time_series", { location: "a|ip=b", ip: "c", dateStart: "2026-01-01", dateEnd: "2026-01-01" }, { location: "a", ip: "b|ip=c", dateStart: "2026-01-01", dateEnd: "2026-01-01" }],
    ...["lookup_ip", "check_security", "get_abuse_contact"].map(name => [name, {}, { ip: "self" }]),
  ]) {
    clearToolCacheForTests();
    const before = requests.length;
    const a = await call(name, first);
    const b = await call(name, second);
    assert.equal(a.isError, undefined, name);
    assert.equal(b.isError, undefined, name);
    assert.equal(requests.length, before + 2, name);
    await call(name, second);
    assert.equal(requests.length, before + 2, "repeat requests remain cached");
  }
});

test("array projection preserves row identity, nested arrays, nulls and field order", () => {
  const source = { asn: { upstreams: [
    { as_number: "AS1", contacts: [{ name: "one" }, { phone: "123" }] },
    { as_number: "AS2", description: "Only AS2", contacts: [] },
    { as_number: "AS3", description: null, contacts: [{ phone: "456" }] },
  ] } };
  const fields = ["upstreams.as_number", "upstreams.description", "upstreams.contacts.name", "upstreams.contacts.phone"];
  const expected = structuredClone(source);
  for (const selection of [fields, [...fields].reverse(), ["upstreams.description", ...fields]]) {
    assert.deepEqual(applyFieldsAndExcludes(source, { fields: selection.join(","), rootKey: "asn" }), expected);
  }
  assert.deepEqual(applyFieldsAndExcludes(source, { fields: "upstreams.description", rootKey: "asn" }), { asn: { upstreams: [{}, { description: "Only AS2" }, { description: null }] } });
  assert.deepEqual(applyFieldsAndExcludes(source, { fields: "asn,upstreams.description", rootKey: "asn" }), source, "whole-object fields take precedence regardless of order");
});

test("SDK ASN projection never assigns a later row's description to an earlier ASN", async t => {
  const source = { asn: { upstreams: [{ as_number: "AS1" }, { as_number: "AS2", description: "Only AS2" }] } };
  const { call, requests } = await sdk(t, () => source);
  const result = await call("lookup_asn", { asn: "AS1", fields: "upstreams.as_number,upstreams.description" });
  assert.deepEqual(result.structuredContent.data, source);
  assert.equal(requests.length, 1);
});

test("cached IP projection matches include precedence for roots, nested fields and optional location data", async t => {
  const base = { ip: "8.8.8.8", location: { city: "Test", accuracy_radius: "5", confidence: "high", locality: "Test locality", dma_code: "501" }, security: { is_vpn: false, threat_score: 0 }, abuse: { organization: "Contact" }, hostname: "dns.example", user_agent: { name: "Browser" } };
  const { call, requests } = await sdk(t, () => base);
  for (const [include, fields, excludes, expected] of [
    ["security", undefined, "security", base],
    ["security", "location.city", undefined, { ip: base.ip, location: { city: "Test" }, security: base.security }],
    ["security", "security", "security", { ip: base.ip, security: base.security }],
    ["security", "security.is_vpn", "security", { ip: base.ip, security: { is_vpn: false } }],
    ["security", "security.is_vpn,security.threat_score", "security.threat_score", { ip: base.ip, security: { is_vpn: false } }],
    ["geo_accuracy,dma_code", "location.city", undefined, { ip: base.ip, location: base.location }],
    ["geo_accuracy,dma_code", "location.city", "location", { ip: base.ip, location: base.location }],
    ["geo_accuracy,dma_code", "location.accuracy_radius,location.dma_code", "location.accuracy_radius,location.dma_code", { ip: base.ip, location: {} }],
    ["security", "location.city", "location", { ip: base.ip, location: { city: "Test" }, security: base.security }],
    ["security", "location.city", "location.city", { ip: base.ip, location: {}, security: base.security }],
    ["*", "location.city", "security.threat_score", { ip: base.ip, location: { city: "Test" } }],
    ["*", undefined, "security,location", { ip: base.ip, abuse: base.abuse, hostname: base.hostname, user_agent: base.user_agent }],
  ]) {
    clearToolCacheForTests();
    const before = requests.length;
    await call("lookup_ip", { ip: base.ip, include });
    const result = await call("lookup_ip", { ip: base.ip, include, ...(fields === undefined ? {} : { fields }), ...(excludes === undefined ? {} : { excludes }) });
    assert.deepEqual(result.structuredContent.data, expected, JSON.stringify({ include, fields, excludes }));
    assert.equal(requests.length, before + 1, "projecting the cached superset must not spend credits");
  }
});

test("unknown SDK arguments fail clearly before an API call and advertised schemas are strict", async t => {
  const { call, requests, client } = await sdk(t, () => ({ ip: "9.9.9.9" }));
  const { tools } = await client.listTools();
  for (const tool of tools) assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
  for (const [name, args, unknown] of [
    ["lookup_ip", { ips: ["8.8.8.8"] }, "ips"],
    ["lookup_ip", { ip: "8.8.8.8", feilds: "location" }, "feilds"],
    ["get_my_ip", { ip: "8.8.8.8" }, "ip"],
    ["get_cached_result", { cursor: "00000000-0000-0000-0000-000000000000:0", force_refresh: true }, "force_refresh"],
    ["lookup_ip", { [fakeKey]: "ignored" }, "[REDACTED_API_KEY]"],
    ["lookup_ip", JSON.parse('{"__proto__":{"polluted":true}}'), "__proto__"],
  ]) {
    const result = await call(name, args);
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.category, "validation");
    assert.ok(result.structuredContent.error.message.includes(unknown));
    assert.ok(!JSON.stringify(result).includes(fakeKey));
    assert.equal(requests.length, 0);
  }
  const valid = await call("lookup_ip", {});
  assert.equal(valid.structuredContent.data.ip, "9.9.9.9");
  assert.equal(requests.length, 1, "intentionally omitted selectors still work");
});

test("raw stdio rejects prototype keys, null, primitives and nested invalid arguments without API calls", async t => {
  const preload = `globalThis.fetch = async () => { console.error('REGRESSION_UPSTREAM_CALL'); return new Response('{"ip":"9.9.9.9"}'); };`;
  const transport = new StdioClientTransport({
    command: process.execPath, args: [fileURLToPath(new URL("../dist/cli.js", import.meta.url))],
    env: { IPGEOLOCATION_API_KEY: "stdio-dummy-key", NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(preload)}` },
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr.on("data", data => { stderr += data.toString(); });
  const client = new Client({ name: "raw-argument-regression", version: "1.0.0" });
  t.after(() => client.close());
  await client.connect(transport);
  for (const [name, args] of [
    ["lookup_ip", JSON.parse('{"__proto__":{"polluted":true}}')],
    ["lookup_ip", JSON.parse('{"ip":{"__proto__":{"polluted":true}}}')],
    ["bulk_lookup_ip", JSON.parse('{"ips":[{"__proto__":{"polluted":true}}]}')],
    ["bulk_parse_user_agent", JSON.parse('{"uaStrings":[{"__proto__":{"polluted":true}}]}')],
    ["get_cached_result", JSON.parse('{"cursor":{"__proto__":{"polluted":true}}}')],
  ]) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.category, "validation");
    assert.equal(result.structuredContent.error.retryable, false);
    assert.equal(Object.prototype.polluted, undefined);
  }
  for (const args of [null, [], "8.8.8.8", true, 42]) {
    await assert.rejects(() => client.callTool({ name: "lookup_ip", arguments: args }), error => error.code === -32602);
  }
  await assert.rejects(() => client.callTool({ name: "lookup_ip", arguments: {}, task: { ttl: 10000 } }), error => /does not support task creation/.test(error.message));
  assert.ok(!stderr.includes("REGRESSION_UPSTREAM_CALL"));
  const valid = await client.callTool({ name: "lookup_ip", arguments: {} });
  assert.equal(valid.structuredContent.data.ip, "9.9.9.9");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stderr.split("REGRESSION_UPSTREAM_CALL").length - 1, 1);
});

test("blocked redirects return clear non-retryable structured guidance", async t => {
  const { call, requests } = await sdk(t, () => new Response(null, { status: 307, headers: { Location: "https://untrusted.example/receiver" } }));
  const result = await call("lookup_ip", { ip: "8.8.8.8" });
  const error = result.structuredContent.error;
  assert.equal(result.isError, true);
  assert.equal(error.category, "redirect_blocked");
  assert.equal(error.source, "mcp_server");
  assert.equal(error.retryable, false);
  assert.match(error.guidance, /Do not retry automatically.*redirect.*support/);
  assert.equal(requests.length, 1);
});

test("ASN exclusions alone do not request optional datasets or create a new cache entry", async t => {
  const { call, requests } = await sdk(t, ({ url }) => ({ asn: { as_number: "AS1", ...(url.searchParams.get("include")?.includes("routes") ? { routes: ["8.8.8.0/24"] } : {}) } }));
  await call("lookup_asn", { asn: "AS1" });
  await call("lookup_asn", { asn: "AS1", excludes: "routes,upstreams.description,asn.whois_response" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.searchParams.get("include"), null);
  const selected = await call("lookup_asn", { asn: "AS1", fields: "routes" });
  assert.deepEqual(selected.structuredContent.data.asn.routes, ["8.8.8.0/24"]);
  assert.equal(requests[1].url.searchParams.get("include"), "routes");
  const excluded = await call("lookup_asn", { asn: "AS1", include: "routes", excludes: "routes" });
  assert.equal(excluded.structuredContent.data.asn.routes, undefined);
  assert.equal(requests.length, 2);
});

for (const name of ["lookup_ip", "bulk_lookup_ip"]) {
  test(`${name} infers optional modules from nested location fields`, async t => {
    const { call, requests } = await sdk(t, ({ body, url }) => {
      assert.equal(url.searchParams.get("include"), "dma_code,geo_accuracy,security");
      const result = { ip: "8.8.8.8", location: { accuracy_radius: "5", confidence: "high", locality: "Test", dma_code: "501" }, security: { is_vpn: false } };
      return body ? [result] : result;
    });
    const result = await call(name, { ...(name.startsWith("bulk_") ? { ips: ["8.8.8.8"] } : { ip: "8.8.8.8" }), include: "Security", fields: "location.accuracy_radius,location.confidence,location.locality,location.dma_code,security.is_vpn" });
    assert.equal(result.isError, undefined);
    assert.equal(requests.length, 1);
  });
}

test("native fetch rejects cross-origin GET and POST redirects without forwarding credentials or bodies", async t => {
  const nativeFetch = globalThis.fetch;
  let received = 0;
  const destination = createServer((_req, res) => { received++; res.end('{"redirected":true}'); });
  const upstream = createServer((req, res) => { req.resume(); res.writeHead(req.method === "POST" ? 307 : 302, { Location: `http://127.0.0.1:${destination.address().port}/receiver` }); res.end(); });
  destination.listen(0, "127.0.0.1"); upstream.listen(0, "127.0.0.1");
  await Promise.all([once(destination, "listening"), once(upstream, "listening")]);
  globalThis.fetch = (url, options) => nativeFetch(`http://127.0.0.1:${upstream.address().port}${new URL(url).pathname}`, options);
  t.after(async () => {
    globalThis.fetch = nativeFetch;
    upstream.closeAllConnections(); destination.closeAllConnections();
    await Promise.all([new Promise(resolve => upstream.close(resolve)), new Promise(resolve => destination.close(resolve))]);
  });
  await withRuntimeConfig({ apiKey: "redirect-test-dummy-key" }, async () => {
    for (const action of [() => getIpGeolocation({ ip: "8.8.8.8" }), () => getIpGeolocationBulk({ ips: ["8.8.8.8"] })]) {
      await assert.rejects(action, error => error.status === 502 && error.source === "mcp_server" && /Redirects are blocked/.test(error.message));
      assert.equal(received, 0);
    }
  });
});

test("build uses portable Node commands and preserves a single executable CLI shebang", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.doesNotMatch(pkg.scripts.build, /\b(?:printf|cat|mv|chmod)\b(?!Sync)/);
  const cli = await readFile(new URL("../dist/cli.js", import.meta.url), "utf8");
  assert.equal(cli.split("\n")[0], "#!/usr/bin/env node");
  assert.equal(cli.match(/#!\/usr\/bin\/env node/g).length, 1);
});
