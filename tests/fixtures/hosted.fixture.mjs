import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createHostedServer } from "../../dist/http.js";
import { loadHostedConfig } from "../../dist/http-config.js";
import { createMcpServer } from "../../dist/index.js";
import { clearToolCacheForTests } from "../../dist/tools/cache.js";

export const KEY_A = "synthetic-hosted-key-A";
export const KEY_B = "synthetic-hosted-key-B";
export const nativeFetch = globalThis.fetch;
export const rpcHeaders = key => ({
  "Content-Type": "application/json", Accept: "application/json, text/event-stream",
  ...(key === undefined ? {} : { "X-IPGeolocation-API-Key": key }),
});
export const initialize = (id = 1) => ({
  jsonrpc: "2.0", id, method: "initialize",
  params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "hosted-test", version: "1.0.0" } },
});

export async function hosted(t, overrides = {}) {
  clearToolCacheForTests();
  const logs = [];
  const config = {
    ...loadHostedConfig({ IPGEOLOCATION_MCP_HTTP_PORT: "0", IPGEOLOCATION_MCP_PUBLIC_URL: "http://127.0.0.1/mcp" }),
    ...overrides,
  };
  const service = createHostedServer(config, entry => logs.push(entry));
  service.server.listen(0, "127.0.0.1");
  await once(service.server, "listening");
  const url = new URL("http://127.0.0.1:" + service.server.address().port + "/mcp");
  config.publicUrl = url;
  config.allowedOrigins = new Set([url.origin]);
  t.after(async () => { await service.close(); clearToolCacheForTests(); });
  return {
    ...service, url, logs, config,
    request(body, { key = KEY_A, headers = {}, method = "POST", path = "/mcp" } = {}) {
      return nativeFetch(new URL(path, url), {
        method, headers: { ...rpcHeaders(key), ...headers },
        ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
      });
    },
  };
}

export async function connect(t, url, key = KEY_A) {
  const client = new Client({ name: "hosted-protocol-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { "X-IPGeolocation-API-Key": key } }, fetch: nativeFetch,
  });
  t.after(async () => { await client.close(); });
  await client.connect(transport, { timeout: 5000 });
  return { client, transport, call: (name, args = {}, options) => client.callTool({ name, arguments: args }, undefined, options) };
}

export async function local(t, key = KEY_A) {
  const mcp = createMcpServer({ apiKey: key });
  const client = new Client({ name: "local-parity-test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await mcp.close(); });
  await mcp.connect(b);
  await client.connect(a);
  return client;
}

// Exercise the real API client over HTTP while restricting the provider to loopback.
export async function upstream(t, responder = defaultProvider) {
  const calls = [];
  const sockets = new Set();
  const fixture = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://fixture");
    const buffers = [];
    for await (const chunk of req) buffers.push(chunk);
    const body = buffers.length ? JSON.parse(Buffer.concat(buffers).toString("utf8")) : undefined;
    const call = { url, body, method: req.method, headers: req.headers };
    calls.push(call);
    const reply = await responder(call, req, res);
    if (res.writableEnded || res.destroyed || reply === undefined) return;
    const status = reply.status ?? 200;
    const payload = Object.hasOwn(reply, "payload") ? reply.payload : reply;
    res.writeHead(status, { "Content-Type": "application/json", ...reply.headers });
    res.end(typeof payload === "string" ? payload : JSON.stringify(payload));
  });
  fixture.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  fixture.listen(0, "127.0.0.1");
  await once(fixture, "listening");
  const origin = "http://127.0.0.1:" + fixture.address().port;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (input, options) => {
    const url = new URL(input);
    assert.equal(url.origin, "https://api.ipgeolocation.io", "unexpected provider destination");
    return nativeFetch(origin + url.pathname + url.search, options);
  };
  t.after(async () => {
    globalThis.fetch = previousFetch;
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => fixture.close(resolve));
  });
  return { calls };
}

export function defaultProvider({ url, body }) {
  const ip = url.searchParams.get("ip") || "8.8.8.8";
  const ipData = ip => ({
    ip, location: { city: "Mountain View", country_name: "United States", country_code2: "US" },
    asn: { as_number: "AS15169", organization: "Google LLC", country: "US" },
    company: { name: "Google LLC", type: "isp", domain: "google.com" },
    network: { route: "8.8.8.0/24", connection_type: "hosting", is_anycast: true },
    currency: { code: "USD", name: "US Dollar" }, country_metadata: { tld: ".us" },
    security: { threat_score: 10, is_tor: false, is_proxy: false, is_vpn: false },
    abuse: { email: "abuse@example.test", route: "8.8.8.0/24" },
  });
  switch (url.pathname) {
    case "/v3/ipgeo": case "/v3/security": case "/v3/abuse": return ipData(ip);
    case "/v3/ipgeo-bulk": case "/v3/security-bulk": return body.ips.map(ipData);
    case "/v3/asn": return { asn: { as_number: "AS13335", organization: "Cloudflare", routes: [{ route: "1.1.1.0/24" }], peers: [{ as_number: "AS1" }], whois_response: "Synthetic registry data" } };
    case "/v3/timezone": return { time_zone: { name: "Europe/London", current_time: "12:00:00", offset: 0 } };
    case "/v3/timezone/convert": return { original_time: "2026-11-14 12:00", converted_time: "2026-11-14 17:00" };
    case "/v3/astronomy": return { location: { country_name: "Pakistan" }, astronomy: { sunrise: "06:45", sunset: "17:45" } };
    case "/v3/astronomy/timeSeries": return { location: { country_name: "Pakistan" }, astronomy: [{ date: "2026-11-14", sunrise: "06:45", sunset: "17:45" }] };
    case "/v3/user-agent": return { user_agent_string: body.uaString, browser: { name: "Synthetic" } };
    case "/v3/user-agent-bulk": return body.uaStrings.map(ua => ({ user_agent_string: ua }));
    default: throw new Error("Unexpected fixture route: " + url.pathname);
  }
}
