import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { hosted, upstream, defaultProvider, initialize, rpcHeaders, nativeFetch, KEY_A, KEY_B } from "./fixtures/hosted.fixture.mjs";

test("one API key and source can send 5001 sequential MCP calls without a timed quota", async t => {
  const api = await upstream(t);
  const service = await hosted(t);
  const init = await service.request(initialize());
  const headers = { "Mcp-Session-Id": init.headers.get("mcp-session-id"), "Mcp-Protocol-Version": "2025-11-25" };
  await init.arrayBuffer();
  for (let i = 0; i < 5001; i++) {
    const response = await service.request({ jsonrpc: "2.0", id: i + 2, method: "tools/call", params: {
      name: "lookup_ip", arguments: { ip: "8.8.8.8" },
    } }, { headers });
    assert.equal(response.status, 200, "request " + i);
    assert.equal((await response.json()).result.isError, undefined);
  }
  assert.equal(api.calls.length, 1, "cache reuse changes no account allowance");
});

test("invalid traffic from rotating keys and sources creates no timed lockout", async t => {
  const service = await hosted(t);
  for (let i = 0; i < 5001; i++) {
    const response = await service.request({}, { key: "synthetic-invalid-" + i, headers: { "X-Real-IP": "2001:db8:" + i.toString(16) + "::1" } });
    assert.equal(response.status, 400);
    await response.arrayBuffer();
  }
  assert.equal((await service.request(initialize(), { key: KEY_B })).status, 200);
});

test("initialization rejects oversized declared bodies before waiting for an upload", async t => {
  const service = await hosted(t);
  const status = new Promise((resolve, reject) => {
    const req = http.request(service.url, { method: "POST", headers: {
      ...rpcHeaders(KEY_A), "Content-Length": String(64 * 1024 + 1),
    } }, res => { res.resume(); resolve(res.statusCode); });
    req.on("error", reject);
    t.after(() => req.destroy());
    req.flushHeaders();
  });
  assert.equal(await status, 413);
});

test("two slow large uploads cannot spend the small-message buffer or execution capacity", async t => {
  const limit = 128 * 1024;
  const service = await hosted(t, { maxBodyBytes: limit });
  const init = await service.request(initialize());
  const victim = { "Mcp-Session-Id": init.headers.get("mcp-session-id"), "Mcp-Protocol-Version": "2025-11-25" };
  await init.arrayBuffer();
  const uploads = [];
  t.after(() => uploads.forEach(req => req.destroy()));
  for (let i = 0; i < 2; i++) {
    const key = "synthetic-large-upload-" + i;
    const next = await service.request(initialize(), { key });
    const session = next.headers.get("mcp-session-id");
    await next.arrayBuffer();
    const req = http.request(service.url, { method: "POST", headers: {
      ...rpcHeaders(key), "Mcp-Session-Id": session, "Mcp-Protocol-Version": "2025-11-25", "Content-Length": String(limit),
    } }, res => res.resume());
    req.on("error", () => {});
    uploads.push(req);
    req.write(Buffer.alloc(limit - 1, 0x20));
  }
  await delay(30);
  const listed = await service.request({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { headers: victim });
  assert.equal(listed.status, 200);
  await listed.arrayBuffer();
  assert.equal((await service.request(initialize(), { key: KEY_B })).status, 200);
  // Only the full large-body pool rejects more large input; small calls still work.
  const rejected = await service.request(" ".repeat(limit), { headers: victim });
  assert.equal(rejected.status, 503);
  assert.equal((await rejected.json()).error, "body_capacity");
  uploads.forEach(req => req.destroy());
  await delay(20);
  const recovered = await service.request(" ".repeat(limit), { headers: victim });
  assert.equal(recovered.status, 400, "large-body budget is reclaimed after disconnects");
});

test("32 one-byte slow uploads do not occupy any execution slots", async t => {
  const service = await hosted(t);
  const init = await service.request(initialize());
  const headers = { "Mcp-Session-Id": init.headers.get("mcp-session-id"), "Mcp-Protocol-Version": "2025-11-25" };
  await init.arrayBuffer();
  const uploads = [];
  t.after(() => uploads.forEach(req => req.destroy()));
  for (let i = 0; i < 32; i++) {
    const req = http.request(service.url, { method: "POST", headers: {
      ...rpcHeaders("synthetic-small-upload-" + i), "Content-Length": "1000",
    } }, res => res.resume());
    req.on("error", () => {});
    req.write("{");
    uploads.push(req);
  }
  await delay(30);
  const listed = await service.request({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { headers });
  assert.equal(listed.status, 200);
  await listed.arrayBuffer();
  assert.equal((await service.request(initialize(), { key: KEY_B })).status, 200);
});

test("a slow upload does not reduce the execution deadline for the provider call", async t => {
  await upstream(t, async call => { await delay(80); return defaultProvider(call); });
  const service = await hosted(t, { requestTimeoutMs: 120 });
  const init = await service.request(initialize());
  const session = init.headers.get("mcp-session-id");
  await init.arrayBuffer();
  const body = JSON.stringify({ jsonrpc: "2.0", id: 42, method: "tools/call", params: {
    name: "lookup_ip", arguments: { ip: "8.8.8.8" },
  } });
  const response = new Promise((resolve, reject) => {
    const req = http.request(service.url, { method: "POST", headers: {
      ...rpcHeaders(KEY_A), "Mcp-Session-Id": session, "Mcp-Protocol-Version": "2025-11-25",
      "Content-Length": String(Buffer.byteLength(body)),
    } }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    req.on("error", reject);
    t.after(() => req.destroy());
    req.write(body.slice(0, 10));
    void delay(80).then(() => req.end(body.slice(10)));
  });
  const result = await response;
  assert.equal(result.status, 200);
  assert.equal(result.body.result.structuredContent.data.ip, "8.8.8.8");
});
