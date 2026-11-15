import assert from "node:assert/strict";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHostedServer } from "../dist/http.js";
import { loadHostedConfig } from "../dist/http-config.js";

// Explicit opt-in only: successful provider calls use the supplied accounts' credits.
const freeKey = process.env.IPGEOLOCATION_LIVE_FREE_KEY;
const paidKey = process.env.IPGEOLOCATION_LIVE_PAID_KEY;
if (!freeKey || !paidKey || freeKey === paidKey) throw new Error("Set two distinct IPGEOLOCATION_LIVE_FREE_KEY and IPGEOLOCATION_LIVE_PAID_KEY values in private runtime configuration.");
process.env.IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS = "10000";
const externalUrl = process.env.IPGEOLOCATION_LIVE_MCP_URL;
const config = loadHostedConfig({ IPGEOLOCATION_MCP_HTTP_PORT: "0", IPGEOLOCATION_MCP_PUBLIC_URL: externalUrl ?? "http://127.0.0.1/mcp" });
const logs = [];
const service = externalUrl ? undefined : createHostedServer(config, entry => logs.push(entry));
const connections = [];
const checks = [];
let cachedPages = 0;
const safe = value => {
  let text = String(value);
  for (const key of [freeKey, paidKey]) text = text.split(key).join("[REDACTED]").split(encodeURIComponent(key)).join("[REDACTED]");
  return text;
};
async function check(name, action) {
  await action();
  checks.push(name);
  console.log("PASS " + name);
}
async function connect(key) {
  const client = new Client({ name: "ipgeolocation-hosted-live-verification", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(config.publicUrl, {
    requestInit: { redirect: "error", headers: { "X-IPGeolocation-API-Key": key } },
  });
  connections.push({ client, transport });
  await client.connect(transport, { timeout: 15000 });
  return { client, transport };
}
async function invoke(connection, name, args = {}) {
  let result = await connection.client.callTool({ name, arguments: args }, undefined, { timeout: 30000 });
  assert.equal(result.isError, undefined, name + " failed");
  assert.ok(!JSON.stringify(result).includes(freeKey) && !JSON.stringify(result).includes(paidKey), "credential in tool output");
  if (!result.structuredContent.page) return result.structuredContent;
  let combined = "";
  for (let pages = 0; pages < 100; pages++) {
    const page = result.structuredContent.page;
    assert.equal(page.offset, combined.length);
    combined += page.json_fragment;
    if (!page.next_cursor) return JSON.parse(combined);
    cachedPages++;
    result = await connection.client.callTool({ name: "get_cached_result", arguments: { cursor: page.next_cursor } });
    assert.equal(result.isError, undefined);
  }
  throw new Error("Unbounded live pagination");
}

try {
  if (service) {
    service.server.listen(0, "127.0.0.1");
    await once(service.server, "listening");
    config.publicUrl = new URL("http://127.0.0.1:" + service.server.address().port + "/mcp");
    config.allowedOrigins = new Set([config.publicUrl.origin]);
  }
  const free = await connect(freeKey);
  const paid = await connect(paidKey);
  await check("all sixteen hosted tools discovered; machine-IP tool absent", async () => {
    for (const connection of [free, paid]) {
      const tools = (await connection.client.listTools()).tools;
      assert.equal(tools.length, 16);
      assert.ok(!tools.some(tool => tool.name === "get_my_ip"));
    }
  });
  await check("free key returns IP location and basic ASN", async () => {
    const { data } = await invoke(free, "lookup_ip", { ip: "1.1.1.1", fields: "ip,location.country_name,asn" });
    assert.equal(data.ip, "1.1.1.1");
    assert.equal(typeof data.location.country_name, "string");
    assert.ok(data.asn);
  });
  await check("free key returns currency and timezone", async () => {
    assert.equal(typeof (await invoke(free, "lookup_currency", { ip: "1.1.1.1" })).data.currency.code, "string");
    assert.equal((await invoke(free, "get_timezone", { tz: "Europe/London" })).data.time_zone.name, "Europe/London");
  });
  await check("free paid-only security is refused with the provider's status", async () => {
    const result = await free.client.callTool({ name: "check_security", arguments: { ip: "185.220.101.1" } });
    assert.equal(result.isError, true);
    assert.ok([401, 403].includes(result.structuredContent.error.status));
  });
  await check("paid key returns location, company, network, currency, security and abuse", async () => {
    const { data } = await invoke(paid, "lookup_ip", { ip: "185.220.101.1", include: "security,abuse" });
    assert.equal(data.ip, "185.220.101.1");
    assert.ok(data.security);
    for (const name of ["lookup_company", "lookup_network", "lookup_currency", "check_security", "get_abuse_contact"]) {
      const section = await invoke(paid, name, { ip: "1.1.1.1" });
      assert.ok(section.data && typeof section.data === "object", name);
    }
  });
  await check("paid bulk IP/security and cached-page reads return complete results", async () => {
    for (const name of ["bulk_lookup_ip", "bulk_security_check"]) {
      const output = await invoke(paid, name, { ips: ["1.1.1.1", "185.220.101.1"] });
      assert.equal(output.items.length, 2);
      assert.equal(output.errors.length, 0);
    }
  });
  await check("paid ASN lookup and complete live cached-page retrieval", async () => {
    const { data } = await invoke(paid, "lookup_asn", { asn: "AS15169", include: "routes" });
    assert.ok(data.asn);
    assert.ok(cachedPages > 0, "the live run must actually exercise get_cached_result");
  });
  await check("timezone lookup and conversion", async () => {
    assert.equal((await invoke(paid, "get_timezone", { tz: "Asia/Karachi" })).data.time_zone.name, "Asia/Karachi");
    const { data } = await invoke(paid, "convert_timezone", { time: "2026-11-14 12:00", tz_from: "Europe/London", tz_to: "Asia/Karachi" });
    assert.ok(data.converted_time || data.time_to || data.date_time_to || data.to);
  });
  await check("astronomy single date and time series", async () => {
    const location = "Karachi, PK";
    assert.ok((await invoke(paid, "get_astronomy", { location, date: "2026-11-14" })).data.astronomy);
    const output = await invoke(paid, "get_astronomy_time_series", { location, dateStart: "2026-11-14", dateEnd: "2026-11-15" });
    assert.ok(Array.isArray(output.data.astronomy));
  });
  await check("single and bulk user-agent parsing", async () => {
    const uaString = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
    assert.ok((await invoke(paid, "parse_user_agent", { uaString })).data);
    const output = await invoke(paid, "bulk_parse_user_agent", { uaStrings: [uaString, "curl/8.0"] });
    assert.equal(output.items.length, 2);
  });
  await check("keys cannot take over each other's sessions", async () => {
    const result = await fetch(config.publicUrl, {
      method: "POST", headers: {
        "Content-Type": "application/json", Accept: "application/json, text/event-stream",
        "X-IPGeolocation-API-Key": paidKey, "Mcp-Session-Id": free.transport.sessionId, "Mcp-Protocol-Version": "2025-11-25",
      }, body: JSON.stringify({ jsonrpc: "2.0", id: 999, method: "tools/list" }),
    });
    assert.equal(result.status, 404);
  });
  await check("invalid provider key fails without affecting valid customers", async () => {
    const invalid = await connect("hosted-live-deliberately-invalid-key");
    const result = await invalid.client.callTool({ name: "lookup_ip", arguments: { ip: "1.1.1.1" } });
    assert.equal(result.isError, true);
    assert.ok([401, 403].includes(result.structuredContent.error.status));
    assert.equal((await invoke(free, "lookup_ip", { ip: "1.1.1.1", fields: "ip,location.country_name,asn" })).data.ip, "1.1.1.1");
  });
  assert.ok(!JSON.stringify(logs).includes(freeKey) && !JSON.stringify(logs).includes(paidKey));
  console.log(JSON.stringify({ checks: checks.length, cachedPageReads: cachedPages, credentialExposure: false, passed: true }));
} catch (error) {
  console.error("FAIL hosted live verification: " + safe(error instanceof Error ? error.message : error));
  process.exitCode = 1;
} finally {
  for (const { client, transport } of connections) {
    try { await transport.terminateSession(); } catch {}
    await client.close();
  }
  await service?.close();
}
