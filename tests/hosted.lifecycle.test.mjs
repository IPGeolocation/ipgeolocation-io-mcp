import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { hosted, connect, upstream, defaultProvider, KEY_A, KEY_B, initialize, rpcHeaders } from "./fixtures/hosted.fixture.mjs";

test("saturated clients can cancel work through the bounded control reserve", async t => {
  let entered;
  let disconnected;
  const started = new Promise(resolve => { entered = resolve; });
  const aborted = new Promise(resolve => { disconnected = resolve; });
  const api = await upstream(t, (_call, _req, res) => {
    res.once("close", () => disconnected());
    entered();
    return undefined;
  });
  const service = await hosted(t, { maxConcurrent: 1 });
  const remote = await connect(t, service.url);
  const controller = new AbortController();
  const pending = remote.call("lookup_ip", { ip: "8.8.8.8" }, { signal: controller.signal });
  const rejected = assert.rejects(pending);
  await started;
  const illicit = await service.request({
    jsonrpc: "2.0", id: 777, method: "tools/call", params: { name: "lookup_ip", arguments: { ip: "1.1.1.1" } },
  }, { headers: { "Mcp-Session-Id": remote.transport.sessionId, "Mcp-Protocol-Version": "2025-11-25" } });
  assert.equal(illicit.status, 503, "ordinary RPC cannot use the control reserve");
  const wrongOwner = await service.request({
    jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 2 },
  }, { key: KEY_B, headers: { "Mcp-Session-Id": remote.transport.sessionId, "Mcp-Protocol-Version": "2025-11-25" } });
  assert.equal(wrongOwner.status, 404);
  controller.abort();
  await rejected;
  await Promise.race([aborted, delay(500).then(() => { throw new Error("Saturated cancellation did not reach provider"); })]);
  assert.equal(api.calls.length, 1);
  await delay(20);
  const next = await connect(t, service.url, KEY_B);
  assert.equal((await next.client.listTools()).tools.length, 16);
});

test("closing a client aborts active HTTP work and immediately frees capacity", async t => {
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  await upstream(t, () => { entered(); return undefined; });
  const service = await hosted(t, { maxConcurrent: 1 });
  const remote = await connect(t, service.url);
  const pending = remote.call("lookup_ip", { ip: "8.8.8.8" });
  const rejected = assert.rejects(pending);
  await started;
  await remote.client.close();
  await rejected;
  const next = await connect(t, service.url, KEY_B);
  assert.equal((await next.client.listTools()).tools.length, 16);
});

test("cancelling one request preserves the connection and other active calls", async t => {
  const opened = [];
  const stopped = new Set();
  await upstream(t, (call, _req, res) => {
    const ip = call.url.searchParams.get("ip");
    opened.push(ip);
    res.once("close", () => stopped.add(ip));
    return undefined;
  });
  const service = await hosted(t);
  const remote = await connect(t, service.url);
  const a = new AbortController();
  const first = remote.call("lookup_ip", { ip: "8.8.8.8" }, { signal: a.signal });
  const firstRejected = assert.rejects(first);
  const b = new AbortController();
  const second = remote.call("lookup_ip", { ip: "1.1.1.1" }, { signal: b.signal });
  const secondRejected = assert.rejects(second);
  for (let i = 0; opened.length < 2 && i < 100; i++) await delay(5);
  assert.equal(opened.length, 2);
  a.abort();
  await firstRejected;
  for (let i = 0; !stopped.has("8.8.8.8") && i < 100; i++) await delay(5);
  assert.ok(stopped.has("8.8.8.8"));
  await delay(10);
  assert.equal((await remote.client.listTools()).tools.length, 16);
  b.abort();
  await secondRejected;
  for (let i = 0; stopped.size < 2 && i < 100; i++) await delay(5);
  assert.equal(stopped.size, 2);
});

test("all sixteen concurrent calls can be cancelled as a burst without leaving provider work", async t => {
  const targets = Array.from({ length: 16 }, (_, i) => "8.8.0." + (i + 1));
  const opened = new Set();
  const stopped = new Set();
  await upstream(t, (call, _req, res) => {
    const ip = call.url.searchParams.get("ip");
    opened.add(ip);
    res.once("close", () => stopped.add(ip));
    return undefined;
  });
  const service = await hosted(t, { maxConcurrent: 16 });
  const remote = await connect(t, service.url);
  const controllers = targets.map(() => new AbortController());
  const calls = targets.map((ip, i) => remote.call("lookup_ip", { ip }, { signal: controllers[i].signal }));
  const rejected = calls.map(call => assert.rejects(call));
  for (let i = 0; opened.size < 16 && i < 100; i++) await delay(5);
  assert.equal(opened.size, 16);
  controllers.forEach(controller => controller.abort());
  await Promise.all(rejected);
  for (let i = 0; stopped.size < 16 && i < 100; i++) await delay(5);
  assert.equal(stopped.size, 16);
  assert.equal(opened.size, 16, "cancellation makes no replacement API calls");
  const next = await connect(t, service.url, KEY_B);
  assert.equal((await next.client.listTools()).tools.length, 16);
});

function launch(t, overrides) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith("IPGEOLOCATION_")) delete env[name];
  Object.assign(env, {
    IPGEOLOCATION_MCP_HTTP_PORT: "0", IPGEOLOCATION_MCP_PUBLIC_URL: "http://127.0.0.1:0/mcp",
  }, overrides);
  const child = spawn(process.execPath, ["dist/http-cli.js"], { env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  const exit = once(child, "exit");
  child.stdout.on("data", data => { stdout += data; });
  child.stderr.on("data", data => { stderr += data; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exit; }
  });
  return { child, exit, stdout: () => stdout, stderr: () => stderr };
}

test("hosted CLI listens, reports its port and exits cleanly on SIGTERM", async t => {
  const process = launch(t);
  const deadline = Date.now() + 3000;
  let listening;
  while (!listening && Date.now() < deadline) {
    for (const line of process.stderr().split("\n").filter(Boolean)) {
      const event = JSON.parse(line);
      if (event.event === "http_listening") listening = event;
    }
    if (!listening) await delay(10);
  }
  assert.ok(listening);
  const response = await fetch("http://127.0.0.1:" + listening.port + "/health");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
  process.child.kill("SIGTERM");
  assert.deepEqual(await process.exit, [0, null]);
  assert.equal(process.stdout(), "");
});

test("hosted CLI fails safely on invalid configuration without exposing supplied values", async t => {
  const child = launch(t, { IPGEOLOCATION_MCP_PUBLIC_URL: "https://sensitive-marker@example.test/mcp" });
  assert.deepEqual(await child.exit, [1, null]);
  assert.match(child.stderr(), /http_configuration_failed/);
  assert.ok(!child.stderr().includes("sensitive-marker"));
});

test("hosted CLI bind failure exits without affecting the existing listener", async t => {
  const existing = http.createServer((_req, res) => res.end("existing"));
  existing.listen(0, "127.0.0.1");
  await once(existing, "listening");
  t.after(() => new Promise(resolve => existing.close(resolve)));
  const port = existing.address().port;
  const child = launch(t, { IPGEOLOCATION_MCP_HTTP_PORT: String(port), IPGEOLOCATION_MCP_PUBLIC_URL: "http://127.0.0.1:" + port + "/mcp" });
  assert.deepEqual(await child.exit, [1, null]);
  assert.match(child.stderr(), /http_startup_failed/);
  assert.equal(await (await fetch("http://127.0.0.1:" + port)).text(), "existing");
});
