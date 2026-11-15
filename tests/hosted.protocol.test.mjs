import test from "node:test";
import assert from "node:assert/strict";
import { clearToolCacheForTests } from "../dist/tools/cache.js";
import { hosted, connect, local, upstream, defaultProvider, KEY_A, KEY_B, initialize } from "./fixtures/hosted.fixture.mjs";

const CASES = [
  ["lookup_ip", { ip: "8.8.8.8", include: "security,abuse" }],
  ["bulk_lookup_ip", { ips: ["8.8.8.8", "1.1.1.1"] }],
  ["lookup_company", { ip: "8.8.8.8" }],
  ["lookup_currency", { ip: "8.8.8.8" }],
  ["lookup_network", { ip: "8.8.8.8" }],
  ["check_security", { ip: "8.8.8.8" }],
  ["bulk_security_check", { ips: ["8.8.8.8", "1.1.1.1"] }],
  ["get_timezone", { tz: "Europe/London" }],
  ["convert_timezone", { time: "2026-11-14 12:00", tz_from: "Europe/London", tz_to: "Asia/Karachi" }],
  ["get_astronomy", { location: "Karachi, PK", date: "2026-11-14" }],
  ["get_astronomy_time_series", { location: "Karachi, PK", dateStart: "2026-11-14", dateEnd: "2026-11-15" }],
  ["lookup_asn", { asn: "AS13335", include: "routes,peers,whois_response" }],
  ["get_abuse_contact", { ip: "8.8.8.8" }],
  ["parse_user_agent", { uaString: "Synthetic Browser/1.0" }],
  ["bulk_parse_user_agent", { uaStrings: ["Browser/1", "Browser/2"] }],
];

test("hosted tools preserve the local contract with only documented machine-IP differences", async t => {
  const api = await upstream(t);
  const service = await hosted(t);
  const remote = await connect(t, service.url);
  const reference = await local(t);
  const localTools = (await reference.listTools()).tools;
  const remoteTools = (await remote.client.listTools()).tools;
  assert.equal(localTools.length, 17);
  assert.equal(remoteTools.length, 16);
  assert.deepEqual(remoteTools.map(t => t.name).sort(), localTools.filter(t => t.name !== "get_my_ip").map(t => t.name).sort());
  for (const tool of remoteTools) {
    const original = localTools.find(t => t.name === tool.name);
    assert.deepEqual(tool.outputSchema, original.outputSchema);
    assert.deepEqual(tool.annotations, original.annotations);
    assert.equal(tool.title, original.title);
    if (!["lookup_ip", "lookup_company", "lookup_network", "lookup_currency", "check_security", "get_abuse_contact"].includes(tool.name)) {
      if (["get_timezone", "get_astronomy", "get_astronomy_time_series", "lookup_asn"].includes(tool.name)) {
        assert.ok(tool.inputSchema.anyOf?.length > 0);
        const { anyOf, ...other } = tool.inputSchema;
        assert.deepEqual(other, original.inputSchema);
        assert.ok(anyOf.some(branch => branch.required.includes("ip")));
        if (tool.name.includes("astronomy") || tool.name === "get_timezone") {
          assert.ok(anyOf.some(branch => branch.required.join(",") === "lat,long"));
          assert.ok(!anyOf.some(branch => branch.required.length === 1 && ["lat", "long"].includes(branch.required[0])));
        }
      } else assert.deepEqual(tool.inputSchema, original.inputSchema);
    } else {
      assert.ok(tool.inputSchema.required.includes("ip"));
      const fields = structuredClone(tool.inputSchema.properties);
      fields.ip = original.inputSchema.properties.ip;
      assert.deepEqual(fields, original.inputSchema.properties);
    }
  }
  for (const [name, args] of CASES) {
    await t.test(name, async () => {
      clearToolCacheForTests();
      const before = api.calls.length;
      const expected = await reference.callTool({ name, arguments: args });
      assert.equal(expected.isError, undefined);
      assert.equal(api.calls.length, before + 1);
      clearToolCacheForTests();
      const actual = await remote.call(name, args);
      assert.deepEqual(actual, expected);
      assert.equal(api.calls.length, before + 2, "both transports actually reached the HTTP provider fixture");
    });
  }
  assert.ok(Buffer.byteLength(remote.client.getInstructions()) <= 4096);
  assert.match(remote.client.getInstructions(), /cannot discover the end user's IP/);
});

test("hosted tools never infer the user's target from the server's network address", async t => {
  const api = await upstream(t);
  const service = await hosted(t);
  const remote = await connect(t, service.url);
  await assert.rejects(remote.call("get_my_ip"), /Tool not found/);
  for (const name of ["lookup_ip", "lookup_company", "lookup_currency", "lookup_network", "check_security", "get_abuse_contact", "get_timezone", "get_astronomy", "lookup_asn"]) {
    assert.equal((await remote.call(name)).isError, true, name);
  }
  assert.equal((await remote.call("get_astronomy_time_series", { dateStart: "2026-11-14", dateEnd: "2026-11-15" })).isError, true);
  assert.equal(api.calls.length, 0);
});

test("HTTP sessions require the same key on every request and never inherit a server key", async t => {
  const api = await upstream(t);
  const service = await hosted(t);
  const previousKey = process.env.IPGEOLOCATION_API_KEY;
  process.env.IPGEOLOCATION_API_KEY = "forbidden-shared-server-key";
  t.after(() => previousKey === undefined ? delete process.env.IPGEOLOCATION_API_KEY : process.env.IPGEOLOCATION_API_KEY = previousKey);
  const unauthorized = await service.request(initialize(), { key: "" });
  assert.equal(unauthorized.status, 401);
  const a = await connect(t, service.url, KEY_A);
  const b = await connect(t, service.url, KEY_B);
  for (const key of ["", KEY_B]) {
    const response = await service.request({ jsonrpc: "2.0", id: 40, method: "tools/list" }, {
      key, headers: { "Mcp-Session-Id": a.transport.sessionId, "Mcp-Protocol-Version": "2025-11-25" },
    });
    assert.equal(response.status, key ? 404 : 401);
  }
  await a.call("lookup_ip", { ip: "8.8.8.8" });
  await b.call("lookup_ip", { ip: "8.8.8.8" });
  assert.deepEqual(api.calls.map(c => c.headers["x-ipgeolocation-api-key"]), [KEY_A, KEY_B]);
  assert.ok(api.calls.every(c => !c.url.searchParams.has("apiKey")));
  assert.ok(!JSON.stringify(service.logs).includes(KEY_A));
  assert.ok(!JSON.stringify(service.logs).includes(KEY_B));
});

test("cached pages survive new HTTP sessions for their owner and cannot cross API keys", async t => {
  const previous = process.env.IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS;
  process.env.IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS = "10000";
  t.after(() => previous === undefined ? delete process.env.IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS : process.env.IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS = previous);
  const api = await upstream(t, call => ({ ...defaultProvider(call), text: "large response ".repeat(3000) }));
  const service = await hosted(t);
  const a = await connect(t, service.url, KEY_A);
  const b = await connect(t, service.url, KEY_B);
  const first = await a.call("lookup_ip", { ip: "8.8.8.8" });
  const cursor = first.structuredContent.page.next_cursor;
  assert.ok(cursor);
  const other = await b.call("get_cached_result", { cursor });
  assert.equal(other.isError, true);
  const secondA = await connect(t, service.url, KEY_A);
  let result = first;
  let recovered = "";
  do {
    recovered += result.structuredContent.page.json_fragment;
    const next = result.structuredContent.page.next_cursor;
    if (!next) break;
    result = await secondA.call("get_cached_result", { cursor: next });
    assert.equal(result.isError, undefined);
  } while (true);
  assert.equal(JSON.parse(recovered).data.ip, "8.8.8.8");
  assert.equal(api.calls.length, 1);
});

for (const status of [400, 401, 402, 403, 405, 429, 500, 503]) {
  test("hosted upstream HTTP " + status + " matches the local error contract without exposing credentials", async t => {
    await upstream(t, () => ({ status, payload: "<html>provider error " + KEY_A + "</html>" }));
    const service = await hosted(t);
    const remote = await connect(t, service.url);
    const reference = await local(t);
    const args = { name: "lookup_ip", arguments: { ip: "8.8.8.8" } };
    const expected = await reference.callTool(args);
    const actual = await remote.client.callTool(args);
    assert.equal(actual.isError, true);
    assert.deepEqual(actual, expected);
    assert.ok(!JSON.stringify(actual).includes(KEY_A));
    assert.ok(!JSON.stringify(service.logs).includes(KEY_A));
  });
}
