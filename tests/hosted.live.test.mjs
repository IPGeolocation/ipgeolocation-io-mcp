import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { hosted, upstream, defaultProvider, nativeFetch, KEY_A, KEY_B } from "./fixtures/hosted.fixture.mjs";

test("live verification never forwards an API key to a redirect destination", { timeout: 20000 }, async t => {
  await upstream(t, call => {
    const key = call.headers["x-ipgeolocation-api-key"];
    if (![KEY_A, KEY_B].includes(key) || (key === KEY_A && call.url.pathname === "/v3/security")) {
      return { status: 401, payload: { message: "Synthetic plan or key rejection" } };
    }
    const result = defaultProvider(call);
    if (call.url.pathname === "/v3/timezone") result.time_zone.name = call.url.searchParams.get("tz");
    if (call.url.pathname === "/v3/asn") result.asn.routes = Array.from({ length: 1000 }, () => ({ route: "203.0.113.0/24" }));
    return result;
  });
  const providerFetch = globalThis.fetch;
  const service = await hosted(t);
  let destinationRequests = 0;
  const destination = http.createServer((_req, res) => { destinationRequests++; res.writeHead(404).end(); });
  destination.listen(0, "127.0.0.1");
  await once(destination, "listening");
  t.after(async () => { destination.closeAllConnections(); await new Promise(resolve => destination.close(resolve)); });
  const redirect = http.createServer((_req, res) => {
    res.writeHead(307, { Location: "http://127.0.0.1:" + destination.address().port + "/mcp" }).end();
  });
  redirect.listen(0, "127.0.0.1");
  await once(redirect, "listening");
  t.after(async () => { redirect.closeAllConnections(); await new Promise(resolve => redirect.close(resolve)); });

  const names = ["IPGEOLOCATION_LIVE_FREE_KEY", "IPGEOLOCATION_LIVE_PAID_KEY", "IPGEOLOCATION_LIVE_MCP_URL", "IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS"];
  const previous = names.map(name => process.env[name]);
  t.after(() => names.forEach((name, i) => previous[i] === undefined ? delete process.env[name] : process.env[name] = previous[i]));
  process.env.IPGEOLOCATION_LIVE_FREE_KEY = KEY_A;
  process.env.IPGEOLOCATION_LIVE_PAID_KEY = KEY_B;
  process.env.IPGEOLOCATION_LIVE_MCP_URL = service.url.href;

  const output = [];
  const previousLog = console.log, previousError = console.error, previousExitCode = process.exitCode;
  let exitCode;
  try {
    globalThis.fetch = (input, options) => {
      const url = new URL(input);
      if (url.origin === "https://api.ipgeolocation.io") return providerFetch(input, options);
      if (url.origin === service.url.origin && options?.body && JSON.parse(options.body).id === 999) {
        return nativeFetch("http://127.0.0.1:" + redirect.address().port + "/mcp", options);
      }
      assert.equal(url.origin, service.url.origin, "unexpected verifier destination");
      return nativeFetch(input, options);
    };
    console.log = console.error = value => output.push(String(value));
    await import("./hosted.live.mjs");
    exitCode = process.exitCode;
  } finally {
    globalThis.fetch = providerFetch;
    console.log = previousLog;
    console.error = previousError;
    process.exitCode = previousExitCode;
  }
  assert.ok(output.includes("PASS single and bulk user-agent parsing"), "the verifier must reach its cross-key request");
  assert.equal(destinationRequests, 0, "the redirect destination must receive no request or API key");
  assert.equal(exitCode, 1, "an unexpected redirect must fail verification");
  assert.ok(output.some(line => line.startsWith("FAIL hosted live verification:")));
});
