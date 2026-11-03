import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../dist/index.js";
import { clearToolCacheForTests } from "../dist/tools/cache.js";
import { normalizeLookupArguments } from "../dist/tools/validation.js";
import * as api from "../dist/client.js";

const selectorNames = new Set([
  "ip", "asn", "lang", "tz", "lat", "long", "location", "iata_code", "icao_code", "lo_code",
  "tz_from", "tz_to", "lat_from", "long_from", "lat_to", "long_to", "location_from", "location_to",
  "iata_from", "iata_to", "icao_from", "icao_to", "locode_from", "locode_to", "date", "dateStart",
  "dateEnd", "elevation", "time_zone", "time",
]);
const baseArgs = {
  lookup_ip: { ip: "8.8.8.8" }, check_security: { ip: "8.8.8.8" },
  get_abuse_contact: { ip: "8.8.8.8" }, lookup_company: { ip: "8.8.8.8" },
  lookup_currency: { ip: "8.8.8.8" }, lookup_network: { ip: "8.8.8.8" },
  lookup_asn: { asn: "AS15169" }, get_timezone: { tz: "Etc/UTC" },
  convert_timezone: { tz_from: "Etc/UTC", tz_to: "Asia/Karachi" },
  get_astronomy: { lat: "0", long: "0" },
  get_astronomy_time_series: { lat: "0", long: "0", dateStart: "2026-12-01", dateEnd: "2026-12-02" },
};
const json = data => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
async function sdk(t, responder) {
  clearToolCacheForTests();
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, options = {}) => {
    const request = { url: new URL(input), body: options.body === undefined ? undefined : JSON.parse(options.body) };
    assert.equal(request.url.origin, "https://api.ipgeolocation.io");
    requests.push(request);
    if (responder) return json(await responder(request));
    if (request.body?.ips) return json(request.body.ips.map(ip => ({ ip })));
    if (request.body?.uaStrings) return json(request.body.uaStrings.map(user_agent_string => ({ user_agent_string })));
    if (request.body?.uaString !== undefined) return json({ user_agent_string: request.body.uaString });
    return json({ ip: request.url.searchParams.get("ip") ?? "203.0.113.9", company: {}, asn: {}, network: {}, currency: {} });
  };
  const server = createMcpServer({ apiKey: "hardening-synthetic-key" });
  const client = new Client({ name: "input-hardening-test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await client.close(); await server.close(); clearToolCacheForTests(); globalThis.fetch = originalFetch;
  });
  await server.connect(b); await client.connect(a);
  return { client, requests, call: (name, args = {}) => client.callTool({ name, arguments: args }) };
}

for (const [name, base] of Object.entries(baseArgs)) {
  test(`${name}: blank advertised selectors fail locally even with another valid selector`, async t => {
    const { client, call, requests } = await sdk(t);
    const tool = (await client.listTools()).tools.find(tool => tool.name === name);
    for (const field of Object.keys(tool.inputSchema.properties).filter(field => selectorNames.has(field))) {
      for (const value of ["", " \t\n"]) {
        const result = await call(name, { ...base, [field]: value });
        assert.equal(result.isError, true, field);
        assert.equal(result.structuredContent.error.source, "mcp_server", field);
        assert.equal(result.structuredContent.error.category, "validation", field);
        assert.equal(result.structuredContent.error.retryable, false, field);
        assert.equal(result.structuredContent.error.status, undefined, field);
        assert.match(result.structuredContent.error.message, /non-blank/, field);
      }
    }
    assert.equal(requests.length, 0);
  });
}
for (const name of ["bulk_lookup_ip", "bulk_security_check"]) {
  test(`${name}: reject blank rows without filtering or billing valid rows`, async t => {
    const { call, requests } = await sdk(t);
    for (const empty of ["", "   ", "\t\n", "\u00a0"]) {
      const result = await call(name, { ips: ["8.8.8.8", empty, "8.8.8.8"] });
      assert.equal(result.isError, true);
      assert.match(result.structuredContent.error.message, /ips\[1\]/);
      assert.equal(result.structuredContent.error.category, "validation");
    }
    assert.equal(requests.length, 0);
  });
  test(`${name}: normalize outbound targets but retain original error labels and duplicates`, async t => {
    const { call, requests } = await sdk(t, request => request.body.ips.map(ip => ip === "10.0.0.1"
      ? { message: "Private address", status: 423 } : { ip }));
    const ips = [" 8.8.8.8 ", " 10.0.0.1 ", "8.8.8.8"];
    const result = await call(name, { ips });
    assert.equal(result.isError, undefined);
    assert.deepEqual(requests[0].body.ips, ["8.8.8.8", "10.0.0.1", "8.8.8.8"]);
    assert.deepEqual(ips, [" 8.8.8.8 ", " 10.0.0.1 ", "8.8.8.8"]);
    assert.equal(result.structuredContent.errors[0].input_index, 1);
    assert.equal(result.structuredContent.errors[0].input, ips[1]);
    const cached = await call(name, { ips: ["8.8.8.8", "10.0.0.1", "8.8.8.8"] });
    assert.equal(requests.length, 1);
    assert.equal(cached.structuredContent.errors[0].input, "10.0.0.1");
  });
}
for (const name of ["lookup_ip", "check_security", "get_abuse_contact", "lookup_company", "lookup_currency", "lookup_network", "lookup_asn"]) {
  test(`${name}: cold, warm and forced paths use the same canonical IP`, async t => {
    const { call, requests } = await sdk(t);
    const result = await call(name, { ip: " 2001:4860:4860::ABCD " });
    assert.equal(result.isError, undefined);
    assert.equal(requests[0].url.searchParams.get("ip"), "2001:4860:4860::abcd");
    await call(name, { ip: "2001:4860:4860::abcd" });
    assert.equal(requests.length, 1);
    await call(name, { ip: " 2001:4860:4860::ABCD ", force_refresh: true });
    assert.equal(requests.length, 2);
    assert.equal(requests[1].url.searchParams.get("ip"), "2001:4860:4860::abcd");
  });
}

test("omitted targets retain host-egress defaults; zero coordinates remain explicit", async t => {
  const { call, requests } = await sdk(t);
  for (const name of ["lookup_ip", "check_security", "get_abuse_contact", "lookup_company", "lookup_currency", "lookup_network", "lookup_asn", "get_timezone", "get_astronomy"]) {
    const result = await call(name);
    assert.equal(result.isError, undefined, name);
  }
  assert.ok(requests.every(request => !request.url.searchParams.has("ip")));
  const result = await call("get_timezone", { lat: " 0 ", long: " 0 " });
  assert.equal(result.isError, undefined);
  assert.equal(requests.at(-1).url.searchParams.get("lat"), "0");
  assert.equal(requests.at(-1).url.searchParams.get("long"), "0");
});

test("normalization leaves exact UA, cursor and case-sensitive field selections intact", async t => {
  const args = { ip: " Example.COM ", asn: " as15169 ", lang: " EN ", location: " New York, NY ", fields: "Foo.Bar", excludes: "Foo.bar", uaString: " A\tB\n ", uaStrings: [" B ", " A "], cursor: " opaque " };
  const normalized = normalizeLookupArguments(args);
  assert.equal(args.ip, " Example.COM ");
  assert.equal(normalized.ip, undefined, "ASN takes precedence over the validated IP selector"); assert.equal(normalized.asn, "AS15169");
  assert.equal(normalizeLookupArguments({ ip: args.ip }).ip, "example.com");
  assert.equal(normalized.lang, "en"); assert.equal(normalized.location, "New York, NY");
  for (const name of ["fields", "excludes", "uaString", "cursor"]) assert.equal(normalized[name], args[name]);
  assert.deepEqual(normalized.uaStrings, args.uaStrings);
  const { call, requests } = await sdk(t);
  await call("parse_user_agent", { uaString: args.uaString });
  await call("bulk_parse_user_agent", { uaStrings: args.uaStrings });
  assert.equal(requests[0].body.uaString, args.uaString);
  assert.deepEqual(requests[1].body.uaStrings, args.uaStrings);
});

test("direct API client callers reject blanks before fetch and share normalization policy", async t => {
  const { requests } = await sdk(t);
  const before = process.env.IPGEOLOCATION_API_KEY;
  process.env.IPGEOLOCATION_API_KEY = "direct-hardening-synthetic-key";
  t.after(() => before === undefined ? delete process.env.IPGEOLOCATION_API_KEY : process.env.IPGEOLOCATION_API_KEY = before);
  for (const name of ["getIpGeolocation", "getSecurity", "getAbuseContact", "getAsn", "getTimezone", "getAstronomy", "getAstronomyTimeSeries"]) {
    await assert.rejects(() => api[name]({ ip: " " }), /non-blank/);
  }
  for (const name of ["getIpGeolocationBulk", "getSecurityBulk"]) {
    await assert.rejects(() => api[name]({ ips: ["8.8.8.8", " "] }), /ips\[1\].*non-blank/);
  }
  assert.equal(requests.length, 0);
  await assert.rejects(() => api.parseUserAgent({ uaString: " \t\n" }), /non-blank/);
  await assert.rejects(() => api.parseUserAgentBulk({ uaStrings: ["Mozilla/5.0", " "] }), /uaStrings\[1\].*non-blank/);
  assert.equal(requests.length, 0);
  await api.getIpGeolocation({ ip: " Example.COM ", lang: " EN " });
  assert.equal(requests[0].url.searchParams.get("ip"), "example.com");
  assert.equal(requests[0].url.searchParams.get("lang"), "en");
  await api.getIpGeolocationBulk({ ips: [" EXAMPLE.COM ", "EXAMPLE.COM"] });
  assert.deepEqual(requests[1].body.ips, ["example.com", "example.com"]);
});

test("astronomy clamps negative elevations before requests and shares the zero-elevation cache", async t => {
  const { call, requests } = await sdk(t, request => ({ location: { elevation: request.url.searchParams.get("elevation") }, astronomy: {} }));
  const base = { lat: "0", long: "0" };
  const dates = { dateStart: "2026-12-01", dateEnd: "2026-12-02" };
  for (const elevation of ["-1", " -0.5 ", "-1e200"]) {
    const result = await call("get_astronomy", { ...base, elevation });
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.data.location.elevation, "0");
    assert.equal(requests.at(-1).url.searchParams.get("elevation"), "0");
  }
  const before = requests.length;
  for (const elevation of ["-1", "-0.5", "0"]) {
    const result = await call("get_astronomy_time_series", { ...base, ...dates, elevation });
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.data.location.elevation, "0");
  }
  assert.equal(requests.length, before + 1);
  const validRequests = requests.length;
  for (const name of ["get_astronomy", "get_astronomy_time_series"]) {
    for (const elevation of ["10001", "NaN", "Infinity", "-Infinity", ""]) {
      const result = await call(name, { ...base, ...(name.endsWith("time_series") ? dates : {}), elevation });
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent.error.retryable, false);
    }
  }
  assert.equal(requests.length, validRequests);
  const original = process.env.IPGEOLOCATION_API_KEY;
  process.env.IPGEOLOCATION_API_KEY = "direct-astronomy-synthetic-key";
  t.after(() => original === undefined ? delete process.env.IPGEOLOCATION_API_KEY : process.env.IPGEOLOCATION_API_KEY = original);
  await api.getAstronomy({ ...base, elevation: "-5" });
  await api.getAstronomyTimeSeries({ ...base, ...dates, elevation: "-5" });
  assert.ok(requests.slice(-2).every(request => request.url.searchParams.get("elevation") === "0"));
});

for (const name of ["parse_user_agent", "bulk_parse_user_agent"]) {
  test(`${name}: whitespace-only UA fails before the API without changing valid bytes`, async t => {
    const { call, requests } = await sdk(t);
    for (const blank of [" ", "\t\n", "\u00a0"]) {
      const args = name === "parse_user_agent" ? { uaString: blank } : { uaStrings: ["Mozilla/5.0", blank] };
      const result = await call(name, args);
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent.error.category, "validation");
      assert.equal(result.structuredContent.error.status, undefined);
    }
    assert.equal(requests.length, 0);
    const ua = " Mozilla/5.0\t \n";
    const args = name === "parse_user_agent" ? { uaString: ua } : { uaStrings: [ua, ua] };
    const result = await call(name, args);
    assert.equal(result.isError, undefined);
    assert.equal(requests.length, 1);
    if (name === "parse_user_agent") assert.equal(requests[0].body.uaString, ua);
    else assert.deepEqual(requests[0].body.uaStrings, [ua, ua]);
  });
}


test("explicit ASN queries ignore changing lower-priority IP selectors in requests and caches", async t => {
  const { call, requests } = await sdk(t, () => ({ asn: { as_number: "AS15169" } }));
  for (const ip of ["first.example", "second.example", "8.8.8.8"]) {
    const result = await call("lookup_asn", { asn: " as15169 ", ip });
    assert.equal(result.isError, undefined);
  }
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.searchParams.get("asn"), "AS15169");
  assert.equal(requests[0].url.searchParams.has("ip"), false);
});
