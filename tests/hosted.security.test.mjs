import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { loadHostedConfig } from "../dist/http-config.js";
import { hosted, connect, upstream, defaultProvider, KEY_A, KEY_B, initialize, rpcHeaders, nativeFetch } from "./fixtures/hosted.fixture.mjs";

async function wire(url, { path = "/mcp", method = "POST", headers = {}, body = JSON.stringify(initialize()), chunks, incomplete = false } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname, port: url.port, path,
      method, headers: { ...rpcHeaders(KEY_A), ...headers }, timeout: 2000,
    }, res => {
      const data = [];
      res.on("data", chunk => data.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(data).toString() }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(new Error("Wire fixture timeout")); });
    if (chunks) {
      for (const chunk of chunks) req.write(chunk);
      req.end();
    } else if (incomplete) req.write(body);
    else req.end(body);
  });
}

test("hosted configuration fails closed on unsafe URLs, origins, addresses and limits", () => {
  for (const env of [
    { IPGEOLOCATION_MCP_PUBLIC_URL: "http://example.com/mcp" },
    { IPGEOLOCATION_MCP_PUBLIC_URL: "https://user:secret@example.com/mcp" },
    { IPGEOLOCATION_MCP_PUBLIC_URL: "https://example.com/mcp?apiKey=secret" },
    { IPGEOLOCATION_MCP_PUBLIC_URL: "https://example.com/mcp#fragment" },
    { IPGEOLOCATION_MCP_PUBLIC_URL: "https://example.com/other" },
    { IPGEOLOCATION_MCP_PUBLIC_URL: "not a URL" },
    { IPGEOLOCATION_MCP_HTTP_HOST: "example.com" },
    { IPGEOLOCATION_MCP_ALLOWED_ORIGINS: "*" },
    { IPGEOLOCATION_MCP_ALLOWED_ORIGINS: "https://example.com/path" },
    { IPGEOLOCATION_MCP_ALLOWED_ORIGINS: "null" },
    { IPGEOLOCATION_MCP_ALLOWED_ORIGINS: "http://example.com" },
    { IPGEOLOCATION_MCP_HTTP_CONCURRENCY: "-1" },
    { IPGEOLOCATION_MCP_HTTP_PORT: "999999999999999999" },
  ]) {
    assert.throws(() => loadHostedConfig(env), error => !error.message.includes("user:secret") && !error.message.includes("apiKey=secret"));
  }
  assert.equal(loadHostedConfig({}).host, "127.0.0.1");
  assert.equal(loadHostedConfig({ IPGEOLOCATION_MCP_PUBLIC_URL: "http://[::1]:8787/mcp" }).publicUrl.hostname, "[::1]");
});

test("HTTP enforces exact hosts, paths and origins before tool processing", async t => {
  const service = await hosted(t);
  const badOrigin = await service.request(initialize(), { headers: { Origin: "https://evil.example" } });
  assert.equal(badOrigin.status, 403);
  assert.equal(badOrigin.headers.get("access-control-allow-origin"), null);
  const badHost = await wire(service.url, { headers: { Host: "evil.example" } });
  assert.equal(badHost.status, 421);
  for (const path of ["/mcp/extra", "/mcp\\ignored", "/mcp%2fignored", "//mcp", "/other"]) {
    assert.equal((await wire(service.url, { path })).status, 404, path);
  }
  const query = await wire(service.url, { path: "/mcp?apiKey=" + KEY_A });
  assert.equal(query.status, 400);
  assert.ok(!JSON.stringify(service.logs).includes(KEY_A));
  const nullOrigin = await service.request(initialize(), { headers: { Origin: "null" } });
  assert.equal(nullOrigin.status, 403);
  const get = await nativeFetch(service.url);
  assert.equal(get.status, 405);
  assert.match(get.headers.get("allow"), /POST/);
  assert.equal((await nativeFetch(new URL("/health", service.url))).status, 200);
  const preflight = await nativeFetch(service.url, {
    method: "OPTIONS", headers: {
      Origin: service.url.origin, "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,x-ipgeolocation-api-key,mcp-session-id",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), service.url.origin);
  const denied = await nativeFetch(service.url, { method: "OPTIONS", headers: {
    Origin: service.url.origin, "Access-Control-Request-Headers": "untrusted-custom-header",
  } });
  assert.equal(denied.status, 403);
});

test("duplicate credentials and session headers are rejected instead of being combined", async t => {
  const service = await hosted(t);
  for (const headers of [
    { "X-IPGeolocation-API-Key": [KEY_A, KEY_B] },
    { Origin: [service.url.origin, "https://evil.example"] },
    { "Mcp-Session-Id": ["a".repeat(36), "b".repeat(36)] },
  ]) assert.equal((await wire(service.url, { headers })).status, 400);
  const bearer = await nativeFetch(service.url, { method: "POST", headers: {
    "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: "Bearer " + KEY_A,
  }, body: JSON.stringify(initialize()) });
  assert.equal(bearer.status, 401);
  assert.match(bearer.headers.get("www-authenticate"), /^ApiKey /);
});

test("HTTP rejects malformed, oversized, compressed and non-UTF8 bodies", async t => {
  const service = await hosted(t, { maxBodyBytes: 1024 });
  for (const body of ["{", "", "null", "[]", "42", '{"jsonrpc":"2.0"}']) {
    assert.equal((await service.request(body)).status, 400, body);
  }
  const large = " ".repeat(1025);
  assert.equal((await wire(service.url, { body: large, headers: { "Content-Length": String(large.length) } })).status, 413);
  assert.equal((await wire(service.url, { chunks: [" ".repeat(600), " ".repeat(600)] })).status, 413);
  assert.equal((await wire(service.url, { body: Buffer.from([0xff, 0xfe]) })).status, 400);
  assert.equal((await service.request(initialize(), { headers: { "Content-Encoding": "gzip" } })).status, 415);
  assert.equal((await service.request(initialize(), { headers: { "Content-Type": "text/plain" } })).status, 415);
  assert.equal((await service.request(initialize(), { headers: { Accept: "text/html" } })).status, 406);
  const valid = await service.request(initialize(), { headers: { "Content-Type": 'application/json; charset="utf-8"' } });
  assert.equal(valid.status, 200);
});

test("stateless session termination uses the MCP-permitted405 without revoking a signed ID", async t => {
  const service = await hosted(t);
  const init = await service.request(initialize());
  const headers = { "Mcp-Session-Id": init.headers.get("mcp-session-id"), "Mcp-Protocol-Version": "2025-11-25" };
  await init.arrayBuffer();
  assert.equal((await service.request(undefined, { method: "DELETE", key: KEY_B, headers })).status, 404);
  const removed = await service.request(undefined, { method: "DELETE", headers });
  assert.equal(removed.status, 405);
  assert.match(removed.headers.get("allow"), /POST/);
  for (const method of ["GET", "DELETE"]) {
    const preflight = await nativeFetch(service.url, { method: "OPTIONS", headers: {
      Origin: service.url.origin, "Access-Control-Request-Method": method,
      "Access-Control-Request-Headers": "x-ipgeolocation-api-key,mcp-session-id,mcp-protocol-version",
    } });
    assert.equal(preflight.status, 204);
    assert.ok(preflight.headers.get("access-control-allow-methods").includes(method));
    const browserRequest = await service.request(undefined, { method, headers: { ...headers, Origin: service.url.origin } });
    assert.equal(browserRequest.status, 405);
    assert.equal(browserRequest.headers.get("access-control-allow-origin"), service.url.origin);
  }
  assert.equal((await service.request({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { headers })).status, 200);
  const remote = await connect(t, service.url);
  await remote.transport.terminateSession();
  assert.equal(remote.transport.sessionId, undefined, "SDK accepts405 and clears its own session ID");
});

test("forwarding headers neither authenticate clients nor change their API key", async t => {
  const service = await hosted(t);
  const forwarded = { "X-Real-IP": "garbage", "CF-Connecting-IP": "198.51.100.10", "X-Forwarded-For": "203.0.113.1", Forwarded: "for=203.0.113.1" };
  assert.equal((await service.request(initialize(), { key: "", headers: forwarded })).status, 401);
  assert.equal((await service.request(initialize(), { headers: forwarded })).status, 200);
});

test("a session ID cannot be used to change keys through tool metadata or forwarding headers", async t => {
  const api = await upstream(t);
  const service = await hosted(t);
  const response = await service.request(initialize());
  const session = response.headers.get("mcp-session-id");
  const result = await service.request({
    jsonrpc: "2.0", id: 2, method: "tools/call",
    params: { name: "lookup_ip", arguments: { ip: "8.8.8.8" }, _meta: { apiKey: KEY_B, "openai/subject": "forged" } },
  }, { headers: {
    "Mcp-Session-Id": session, "Mcp-Protocol-Version": "2025-11-25",
    "X-IPGeo-ChatGPT-Verified": "true", "X-Forwarded-Host": "evil.example", Authorization: "Bearer " + KEY_B,
  } });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).result.isError, undefined);
  assert.equal(api.calls[0].headers["x-ipgeolocation-api-key"], KEY_A);
  assert.ok(!api.calls[0].url.searchParams.has("apiKey"));
});

test("concurrent API keys keep cache and provider requests isolated", async t => {
  const api = await upstream(t, async call => {
    await delay(call.headers["x-ipgeolocation-api-key"] === KEY_A ? 20 : 5);
    return { ...defaultProvider(call), identity: call.headers["x-ipgeolocation-api-key"] === KEY_A ? "owner-A" : "owner-B" };
  });
  const service = await hosted(t);
  const a = await connect(t, service.url, KEY_A);
  const b = await connect(t, service.url, KEY_B);
  const [first, second] = await Promise.all([a.call("lookup_ip", { ip: "8.8.8.8" }), b.call("lookup_ip", { ip: "8.8.8.8" })]);
  assert.equal(first.structuredContent.data.identity, "owner-A");
  assert.equal(second.structuredContent.data.identity, "owner-B");
  await a.call("lookup_ip", { ip: "8.8.8.8" });
  await b.call("lookup_ip", { ip: "8.8.8.8" });
  assert.equal(api.calls.length, 2);
});

test("protocol cancellation reaches the provider without an automatic retry", async t => {
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  let disconnected;
  const aborted = new Promise(resolve => { disconnected = resolve; });
  const api = await upstream(t, (_call, _req, res) => {
    res.once("close", () => disconnected());
    entered();
    return undefined;
  });
  const service = await hosted(t);
  const remote = await connect(t, service.url);
  const controller = new AbortController();
  const pending = remote.call("lookup_ip", { ip: "8.8.8.8" }, { signal: controller.signal });
  await started;
  controller.abort();
  await assert.rejects(pending);
  await Promise.race([aborted, delay(1000).then(() => { throw new Error("Provider was not cancelled"); })]);
  assert.equal(api.calls.length, 1);
});

test("request deadlines release hanging calls and leave the service healthy", async t => {
  await upstream(t, () => undefined);
  const service = await hosted(t, { requestTimeoutMs: 50 });
  const remote = await connect(t, service.url);
  await assert.rejects(remote.call("lookup_ip", { ip: "8.8.8.8" }));
  assert.equal((await nativeFetch(new URL("/health", service.url))).status, 200);
  const client = await connect(t, service.url, KEY_B);
  assert.equal((await client.client.listTools()).tools.length, 16);
});

test("graceful shutdown lets an active report finish and force-closes a stalled session", async t => {
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const api = await upstream(t, async call => {
    entered();
    await new Promise(resolve => { release = resolve; });
    return defaultProvider(call);
  });
  const service = await hosted(t, { shutdownGraceMs: 1000 });
  const remote = await connect(t, service.url);
  const pending = remote.call("lookup_ip", { ip: "8.8.8.8" });
  await started;
  let closed = false;
  const closing = service.close().then(() => { closed = true; });
  await delay(20);
  assert.equal(closed, false);
  release();
  assert.equal((await pending).isError, undefined);
  await closing;
  assert.equal(api.calls.length, 1);

  const hung = await hosted(t, { shutdownGraceMs: 30 });
  const next = await connect(t, hung.url);
  entered = () => {};
  const stuck = next.call("lookup_ip", { ip: "1.1.1.1" }).catch(() => undefined);
  await delay(20);
  const began = performance.now();
  await hung.close();
  await stuck;
  assert.ok(performance.now() - began < 1000);
});

test("slow bodies, rejected Expect handshakes and disconnected clients do not crash the process", async t => {
  const service = await hosted(t, { requestTimeoutMs: 40 });
  const expect = await wire(service.url, { headers: { Expect: "100-continue" } });
  assert.equal(expect.status, 417);
  await wire(service.url, { body: "{", incomplete: true }).catch(() => undefined);
  const socket = net.connect(service.url.port, "127.0.0.1");
  await new Promise(resolve => socket.once("connect", resolve));
  socket.on("error", () => {});
  socket.write("POST /mcp HTTP/1.1\r\nHost: " + service.url.host + "\r\nContent-Length: 999\r\n\r\n{");
  socket.destroy();
  await delay(60);
  assert.equal((await nativeFetch(new URL("/health", service.url))).status, 200);
});

test("repeated cancellation frees session and request capacity without waiting for shutdown", async t => {
  let notify;
  await upstream(t, () => { notify(); return undefined; });
  const service = await hosted(t, { maxConcurrent: 2 });
  for (let i = 0; i < 5; i++) {
    const remote = await connect(t, service.url);
    const started = new Promise(resolve => { notify = resolve; });
    const controller = new AbortController();
    const call = remote.call("lookup_ip", { ip: "8.8.8.8" }, { signal: controller.signal });
    await started;
    controller.abort();
    await assert.rejects(call);
    await delay(20);
  }
  const next = await connect(t, service.url);
  assert.equal((await next.client.listTools()).tools.length, 16);
  const began = performance.now();
  await service.close();
  assert.ok(performance.now() - began < 500, "no abandoned JSON response holds a socket until the grace deadline");
});

test("duplicate in-flight RPC IDs cannot overwrite an active response", async t => {
  let release;
  let notify;
  const started = new Promise(resolve => { notify = resolve; });
  await upstream(t, async call => {
    notify();
    await new Promise(resolve => { release = resolve; });
    return defaultProvider(call);
  });
  const service = await hosted(t);
  const response = await service.request(initialize());
  const headers = { "Mcp-Session-Id": response.headers.get("mcp-session-id"), "Mcp-Protocol-Version": "2025-11-25" };
  const body = { jsonrpc: "2.0", id: 42, method: "tools/call", params: { name: "lookup_ip", arguments: { ip: "8.8.8.8" } } };
  const first = service.request(body, { headers });
  await started;
  assert.equal((await service.request(body, { headers })).status, 409);
  release();
  assert.equal((await first).status, 200);
  assert.equal((await service.request({ jsonrpc: "2.0", id: 43, method: "tools/list" }, { headers })).status, 200);
});

test("unverified initialization cannot retain oversized metadata or deeply nested objects", async t => {
  const service = await hosted(t, {});
  const large = initialize();
  large.params.capabilities.experimental = { retained: { blob: "x".repeat(70 * 1024) } };
  for (let i = 0; i < 3; i++) assert.equal((await service.request(large)).status, 413);
  const deep = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":' +
    '{"x":'.repeat(100) + "0" + "}".repeat(100) + ',"clientInfo":{"name":"test","version":"1"}}}';
  assert.equal((await service.request(deep)).status, 400);
  assert.equal((await service.request(initialize())).status, 200, "rejections consume no session slot");
});

test("half-open upgrade and parser-error sockets are destroyed and cannot block shutdown", async t => {
  const service = await hosted(t, { shutdownGraceMs: 30 });
  for (const request of [
    "GET /mcp HTTP/1.1\r\nHost: " + service.url.host + "\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
    "BAD METHOD /mcp HTTP/1.1\r\nHost: " + service.url.host + "\r\n\r\n",
  ]) {
    const socket = net.connect({ host: "127.0.0.1", port: service.url.port, allowHalfOpen: true });
    socket.on("error", () => {});
    socket.resume();
    t.after(() => socket.destroy());
    await new Promise(resolve => socket.once("connect", resolve));
    socket.write(request);
    await new Promise(resolve => socket.once("end", resolve));
  }
  await delay(20);
  const remaining = await new Promise((resolve, reject) => service.server.getConnections((error, count) => error ? reject(error) : resolve(count)));
  assert.equal(remaining, 0);
  const began = performance.now();
  await service.close();
  assert.ok(performance.now() - began < 500);
});

test("connection resets during rejected upgrades cannot crash the HTTP server", async t => {
  const service = await hosted(t);
  for (let i = 0; i < 100; i++) {
    const socket = net.connect({ host: "127.0.0.1", port: service.url.port });
    socket.on("error", () => {});
    await new Promise(resolve => socket.once("connect", resolve));
    socket.write("GET /mcp HTTP/1.1\r\nHost: " + service.url.host + "\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n");
    socket.resetAndDestroy();
  }
  assert.equal((await nativeFetch(new URL("/health", service.url))).status, 200);
});

test("JSON expansion and tool-call envelopes are bounded before SDK dispatch", async t => {
  const api = await upstream(t);
  const service = await hosted(t);
  const remote = await connect(t, service.url);
  const headers = { "Mcp-Session-Id": remote.transport.sessionId, "Mcp-Protocol-Version": "2025-11-25" };
  const tooManyContainers = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"data":[' +
    "{},".repeat(100001) + "invalid tail";
  const rejected = await service.request(tooManyContainers, { headers });
  assert.equal(rejected.status, 413, "structural budget runs before JSON.parse sees the invalid tail");
  assert.equal((await rejected.json()).error, "message_capacity");
  for (const extra of [{ id: "i".repeat(70 * 1024) }, { params: { _meta: { huge: "m".repeat(70 * 1024) } } }]) {
    const base = { jsonrpc: "2.0", id: 100, method: "tools/call", params: { name: "lookup_ip", arguments: { ip: "8.8.8.8" } } };
    const body = extra.params ? { ...base, params: { ...base.params, ...extra.params } } : { ...base, ...extra };
    assert.equal((await service.request(body, { headers })).status, 413);
  }
  assert.equal(api.calls.length, 0);
  const result = await remote.call("parse_user_agent", { uaString: 'Synthetic "quoted" [{:}] \\ browser '.repeat(3000) });
  assert.equal(result.isError, undefined, "large valid tool strings do not count as JSON structure or control metadata");
  assert.equal(api.calls.length, 1);
});
