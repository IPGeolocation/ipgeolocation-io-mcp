import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { hosted, upstream, defaultProvider, initialize, KEY_A, KEY_B } from "./fixtures/hosted.fixture.mjs";

async function session(service, key = KEY_A, version = "2025-11-25") {
  const body = initialize();
  body.params.protocolVersion = version;
  const response = await service.request(body, { key });
  assert.equal(response.status, 200);
  const id = response.headers.get("mcp-session-id");
  const result = await response.json();
  assert.ok(id);
  return { id, version: result.result.protocolVersion, headers: { "Mcp-Session-Id": id, "Mcp-Protocol-Version": result.result.protocolVersion } };
}
const lookup = (id, ip) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "lookup_ip", arguments: { ip } } });
const list = (id = 2) => ({ jsonrpc: "2.0", id, method: "tools/list" });
const cancellation = id => ({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id } });

test("hundreds of idle connections with arbitrary keys cannot invalidate an existing connection", async t => {
  const api = await upstream(t);
  const service = await hosted(t);
  const current = await session(service);
  for (let i = 0; i < 512; i++) await session(service, "synthetic-idle-" + i);
  assert.equal((await service.request(lookup(2, "8.8.8.8"), { headers: current.headers })).status, 200);
  assert.equal(api.calls.length, 1);
  // The same key and source also have no extra session allowance.
  for (let i = 0; i < 20; i++) await session(service);
  assert.equal((await service.request(list(), { headers: current.headers })).status, 200);
});

test("connection IDs are random, signed and bound to the exact API key", async t => {
  const api = await upstream(t);
  const service = await hosted(t);
  const a = await session(service);
  const b = await session(service);
  assert.notEqual(a.id, b.id);
  const parts = a.id.split(".");
  for (const id of ["", "a".repeat(36), a.id + "x", a.id.slice(0, -1),
    [parts[0], "2025-03-26", parts[2], parts[3]].join("."),
    [parts[0], parts[1], "A".repeat(32), parts[3]].join("."),
    [parts[0], parts[1], parts[2], "A".repeat(43)].join(".")]) {
    assert.equal((await service.request(list(), { headers: { ...a.headers, "Mcp-Session-Id": id } })).status, 404);
  }
  assert.equal((await service.request(list(), { key: KEY_B, headers: a.headers })).status, 404);
  assert.equal((await service.request(initialize(), { headers: a.headers })).status, 400);
  assert.equal(api.calls.length, 0);
});

for (const version of ["2025-03-26", "2025-06-18", "2025-11-25", "unsupported-client-version"]) {
  test("signed connections preserve protocol negotiation: " + version, async t => {
    const service = await hosted(t);
    const current = await session(service, KEY_A, version);
    assert.equal(current.version, version === "unsupported-client-version" ? "2025-11-25" : version);
    assert.equal(current.id.split(".")[1], current.version);
    const noHeader = await service.request(list(), { headers: { "Mcp-Session-Id": current.id } });
    assert.equal(noHeader.status, 200);
    assert.equal((await noHeader.json()).result.tools.length, 16);
    assert.equal((await service.request(list(), { headers: { ...current.headers, "Mcp-Protocol-Version": "unsupported" } })).status, 400);
  });
}

test("a different server process cannot accept a previous server's signed connection", async t => {
  const first = await hosted(t);
  const current = await session(first);
  const second = await hosted(t);
  assert.equal((await second.request(list(), { headers: current.headers })).status, 404);
  assert.equal((await first.request(list(), { headers: current.headers })).status, 200);
});

test("cancellation isolates numeric0, string0 and another connection using the same API key", async t => {
  const opened = new Set();
  const stopped = new Set();
  const gates = new Map();
  await upstream(t, async (call, _req, res) => {
    const ip = call.url.searchParams.get("ip");
    opened.add(ip);
    res.once("close", () => stopped.add(ip));
    await new Promise(resolve => gates.set(ip, resolve));
    return defaultProvider(call);
  });
  t.after(() => { for (const resolve of gates.values()) resolve(); });
  const service = await hosted(t);
  const a = await session(service);
  const b = await session(service);
  const first = service.request(lookup(0, "8.8.8.8"), { headers: a.headers });
  const second = service.request(lookup("0", "1.1.1.1"), { headers: a.headers });
  const other = service.request(lookup(0, "9.9.9.9"), { headers: b.headers });
  for (let i = 0; opened.size < 3 && i < 100; i++) await delay(5);
  assert.equal(opened.size, 3);
  assert.equal((await service.request(cancellation(0), { key: KEY_B, headers: a.headers })).status, 404);
  assert.equal((await service.request(cancellation(0), { headers: a.headers })).status, 202);
  assert.equal((await first).status, 204);
  for (let i = 0; !stopped.has("8.8.8.8") && i < 100; i++) await delay(5);
  assert.deepEqual([...stopped], ["8.8.8.8"], "numeric0 cancellation reaches only its provider work");
  assert.equal((await service.request(list(9), { headers: a.headers })).status, 200, "the connection survives cancellation");
  gates.get("1.1.1.1")();
  gates.get("9.9.9.9")();
  assert.equal((await second).status, 200);
  assert.equal((await other).status, 200);
  await delay(10);
  const reused = service.request(lookup(0, "8.8.4.4"), { headers: a.headers });
  for (let i = 0; !gates.has("8.8.4.4") && i < 100; i++) await delay(5);
  assert.ok(gates.has("8.8.4.4"));
  gates.get("8.8.4.4")();
  assert.equal((await reused).status, 200, "completed IDs can be reused");
});
