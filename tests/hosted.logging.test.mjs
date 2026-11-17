import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { loadHostedConfig } from "../dist/http-config.js";
import { hosted, initialize, rpcHeaders, KEY_A } from "./fixtures/hosted.fixture.mjs";

test("logging trusts only configured exact proxy addresses", () => {
  const defaults = loadHostedConfig({});
  assert.deepEqual([...defaults.trustedProxies], ["127.0.0.1", "::1"]);
  assert.ok(loadHostedConfig({ IPGEOLOCATION_MCP_TRUSTED_PROXIES: "172.30.88.1, 2001:db8::1" }).trustedProxies.has("172.30.88.1"));
  for (const address of ["*", "0.0.0.0/0", "proxy.example", "fe80::1%eth0", "invalid"]) {
    assert.throws(() => loadHostedConfig({ IPGEOLOCATION_MCP_TRUSTED_PROXIES: address }), /exact IP addresses/);
  }
  assert.throws(() => loadHostedConfig({ IPGEOLOCATION_MCP_TRUSTED_PROXIES:
    Array.from({ length: 33 }, (_, i) => "192.0.2." + (i + 1)).join(","),
  }), /Too many trusted proxies/);
});

test("trusted proxy logs preserve the client IP and correlate the response without logging credentials", async t => {
  for (const proxy of ["127.0.0.1", "::ffff:127.0.0.1", "::ffff:7f00:1"]) {
    await t.test(proxy, async t => {
      const service = await hosted(t, { trustedProxies: new Set([proxy]) });
      const body = initialize();
      body.params.clientInfo.name = KEY_A;
      const response = await service.request(body, { headers: {
        "X-Real-IP": "2001:db8::7", "X-Forwarded-For": "192.0.2.12", "CF-Connecting-IP": "192.0.2.13",
      } });
      await response.arrayBuffer();
      const entry = service.logs.find(entry => entry.request_id === response.headers.get("x-request-id"));
      assert.equal(entry.client_ip, "2001:db8::7");
      assert.equal(entry.peer_ip, "127.0.0.1");
      assert.equal(entry.status, 200);
      assert.match(entry.timestamp, /^\d{4}-\d{2}-\d{2}T.*Z$/);
      assert.ok(!JSON.stringify(service.logs).includes(KEY_A));
      assert.ok(!JSON.stringify(service.logs).includes("192.0.2.12"));
    });
  }
});

test("untrusted or malformed client-IP claims never replace the actual peer", async t => {
  for (const [trustedProxies, claim] of [
    [new Set(), "192.0.2.10"],
    [new Set(["127.0.0.1"]), "not-an-ip"],
    [new Set(["127.0.0.1"]), "192.0.2.10, 192.0.2.11"],
    [new Set(["127.0.0.1"]), "fe80::1%eth0"],
  ]) {
    const service = await hosted(t, { trustedProxies });
    const response = await service.request(initialize(), { headers: { "X-Real-IP": claim } });
    await response.arrayBuffer();
    assert.equal(service.logs.find(entry => entry.event === "http_request").client_ip, "127.0.0.1");
  }
});

test("duplicate client-IP headers cannot forge request logs", async t => {
  const service = await hosted(t);
  await new Promise((resolve, reject) => {
    const req = http.request(service.url, { method: "POST", headers: {
      ...rpcHeaders(KEY_A), "X-Real-IP": ["192.0.2.10", "192.0.2.11"],
    } }, res => { res.resume(); res.once("end", resolve); res.once("error", reject); });
    req.on("error", reject);
    req.end(JSON.stringify(initialize()));
  });
  assert.equal(service.logs.find(entry => entry.event === "http_request").client_ip, "127.0.0.1");
});

test("interrupted requests log one client IP and a 499 status without retaining the body", async t => {
  const service = await hosted(t);
  const entered = once(service.server, "request");
  const req = http.request(service.url, { method: "POST", headers: { ...rpcHeaders(KEY_A), "Content-Length": "1000" } });
  req.on("error", () => {});
  t.after(() => req.destroy());
  req.write("{");
  await entered;
  req.destroy();
  for (let i = 0; !service.logs.length && i < 100; i++) await delay(5);
  const entries = service.logs.filter(entry => entry.event === "http_request");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].client_ip, "127.0.0.1");
  assert.equal(entries[0].status, 499);
  assert.ok(!JSON.stringify(entries).includes(KEY_A));
});
