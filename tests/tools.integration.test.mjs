import test from "node:test";
import assert from "node:assert/strict";

const TOOL_ENV_KEYS = [
  "IPGEOLOCATION_API_KEY",
  "IPGEOLOCATION_MCP_MAX_BULK_ITEMS",
  "IPGEOLOCATION_MCP_MAX_RESULT_ITEMS",
  "IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS",
  "IPGEOLOCATION_MCP_MAX_ERROR_CHARS",
];

const EXPECTED_TOOL_NAMES = [
  "lookup_ip",
  "bulk_lookup_ip",
  "get_my_ip",
  "lookup_company",
  "lookup_currency",
  "lookup_network",
  "check_security",
  "bulk_security_check",
  "get_timezone",
  "convert_timezone",
  "get_astronomy",
  "get_astronomy_time_series",
  "lookup_asn",
  "get_abuse_contact",
  "parse_user_agent",
  "bulk_parse_user_agent",
];

const EXPECTED_CACHED_TOOL_NAMES = [
  "lookup_ip",
  "bulk_lookup_ip",
  "lookup_company",
  "lookup_currency",
  "lookup_network",
  "check_security",
  "bulk_security_check",
  "get_astronomy_time_series",
  "lookup_asn",
  "get_abuse_contact",
  "parse_user_agent",
  "bulk_parse_user_agent",
];

class ToolRegistryServer {
  constructor() {
    this.tools = new Map();
  }

  registerTool(name, definition, handler) {
    this.tools.set(name, { definition, handler });
  }
}

function clearToolEnv() {
  for (const key of TOOL_ENV_KEYS) {
    delete process.env[key];
  }
}

function distModuleUrl(relativePath) {
  const url = new URL(`../dist/${relativePath}`, import.meta.url);
  url.searchParams.set("t", `${Date.now()}-${Math.random()}`);
  return url.href;
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function parseTextResult(result) {
  assert.ok(result.content?.length, "tool result should include content");
  assert.equal(result.content[0].type, "text");
  return result.content[0].text;
}

async function loadToolRegistry() {
  const [
    geolocation,
    security,
    timezone,
    astronomy,
    asn,
    abuse,
    userAgent,
  ] = await Promise.all([
    import(distModuleUrl("tools/geolocation.js")),
    import(distModuleUrl("tools/security.js")),
    import(distModuleUrl("tools/timezone.js")),
    import(distModuleUrl("tools/astronomy.js")),
    import(distModuleUrl("tools/asn.js")),
    import(distModuleUrl("tools/abuse.js")),
    import(distModuleUrl("tools/useragent.js")),
  ]);

  const server = new ToolRegistryServer();
  geolocation.registerGeolocationTools(server);
  security.registerSecurityTools(server);
  timezone.registerTimezoneTools(server);
  astronomy.registerAstronomyTools(server);
  asn.registerAsnTools(server);
  abuse.registerAbuseTools(server);
  userAgent.registerUserAgentTools(server);
  return server.tools;
}

async function clearRuntimeCaches() {
  const cacheModule = await import(new URL("../dist/tools/cache.js", import.meta.url).href);
  cacheModule.clearToolCacheForTests();
}

function createFetchStub() {
  const calls = [];

  async function fetchStub(input, init = {}) {
    const url = new URL(String(input));
    const method = (init.method || "GET").toUpperCase();
    const rawBody = typeof init.body === "string" ? init.body : undefined;
    const body = rawBody ? JSON.parse(rawBody) : undefined;

    calls.push({ url, method, body, rawBody });

    switch (url.pathname) {
      case "/v3/getip":
        return jsonResponse({ ip: "198.51.100.20" });
      case "/v3/ipgeo":
        {
          const includeSet = new Set(
            (url.searchParams.get("include") || "")
              .split(",")
              .map((part) => part.trim())
              .filter(Boolean)
          );

          const payload = {
            endpoint: "ipgeo",
            ip: url.searchParams.get("ip") || "self",
            fields: url.searchParams.get("fields"),
            location: {
              city: "Test City",
              country_name: "Testland",
            },
            currency: {
              code: "TST",
              name: "Test Currency",
              symbol: "T$",
            },
            country_metadata: {
              calling_code: "+999",
              tld: ".ts",
              languages: ["en"],
            },
            network: {
              route: "203.0.113.0/24",
              is_anycast: false,
            },
            asn: {
              as_number: "AS13335",
              organization: "Cloudflare, Inc.",
              country: "US",
            },
            company: {
              name: "Example Co",
              type: "BUSINESS",
              domain: "example.com",
            },
          };

          if (includeSet.has("security") || includeSet.has("*")) {
            payload.security = {
              threat_score: 0,
              is_vpn: false,
              is_proxy: false,
            };
          }

          if (includeSet.has("abuse") || includeSet.has("*")) {
            payload.abuse = {
              emails: ["abuse@example.com"],
              organization: "Example ISP",
            };
          }

          return jsonResponse(payload);
        }
      case "/v3/ipgeo-bulk":
        return jsonResponse(
          (body?.ips || []).map((ip) => ({
            ip,
            location: { country_name: "Testland" },
          }))
        );
      case "/v3/security":
        return jsonResponse({
          ip: url.searchParams.get("ip") || "self",
          security: {
            threat_score: 0,
            is_vpn: false,
            is_proxy: false,
            is_tor: false,
            vpn_provider_names: [],
            proxy_provider_names: [],
          },
        });
      case "/v3/security-bulk":
        return jsonResponse(
          (body?.ips || []).map((ip, index) => ({
            ip,
            security: { threat_score: index % 100 },
          }))
        );
      case "/v3/timezone":
        return jsonResponse({
          timezone: {
            name: "UTC",
            current_time: "2026-03-05 00:00:00",
          },
        });
      case "/v3/timezone/convert":
        return jsonResponse({
          time_from: "2026-03-05 00:00:00",
          time_to: "2026-03-05 05:00:00",
          diff_hour: 5,
          diff_min: 0,
        });
      case "/v3/astronomy":
        return jsonResponse({
          location: {
            city: "Karachi",
            country_name: "Pakistan",
          },
          astronomy: {
            date: url.searchParams.get("date") || "2026-03-05",
            sunrise: "06:00",
            sunset: "18:00",
          },
        });
      case "/v3/astronomy/timeSeries":
        return jsonResponse({
          location: {
            city: "Karachi",
            country_name: "Pakistan",
          },
          astronomy: [
            { date: url.searchParams.get("dateStart"), sunrise: "06:00" },
            { date: url.searchParams.get("dateEnd"), sunrise: "06:01" },
          ],
        });
      case "/v3/asn":
        if (url.searchParams.get("asn") === "AS_ERROR") {
          return new Response("e".repeat(9000), {
            status: 500,
            statusText: "Internal Server Error",
          });
        }
        {
          const includeSet = new Set(
            (url.searchParams.get("include") || "")
              .split(",")
              .map((part) => part.trim())
              .filter(Boolean)
          );

          const asnPayload = {
            as_number: "AS13335",
            organization: "Cloudflare, Inc.",
            country: "US",
          };

          if (includeSet.has("upstreams")) {
            asnPayload.upstreams = [
              { as_number: "AS64501", description: "Transit A", country: "US" },
              { as_number: "AS64502", description: "Transit B", country: "NL" },
            ];
          }

          if (includeSet.has("peers")) {
            asnPayload.peers = [{ as_number: "AS64503", description: "Peer A" }];
          }

          return jsonResponse({
            asn: asnPayload,
          });
        }
      case "/v3/abuse":
        return jsonResponse({
          abuse: {
            emails: ["abuse@example.com"],
            organization: "Example ISP",
            phone_numbers: ["+1-555-0100"],
            address: "Example Street 1",
          },
        });
      case "/v3/user-agent":
        return jsonResponse({
          user_agent_string: body?.uaString || "",
          name: "Chrome",
          type: "Browser",
        });
      case "/v3/user-agent-bulk":
        return jsonResponse(
          (body?.uaStrings || []).map((ua) => ({
            user_agent_string: ua,
            name: "Chrome",
          }))
        );
      default:
        return new Response("Not Found", { status: 404, statusText: "Not Found" });
    }
  }

  return { calls, fetchStub };
}

async function invoke(tools, name, args = {}) {
  const tool = tools.get(name);
  assert.ok(tool, `Tool '${name}' should be registered`);
  return tool.handler(args);
}

test("registers all MCP tools with expected metadata", async (t) => {
  clearToolEnv();
  process.env.IPGEOLOCATION_API_KEY = "test_api_key_local";
  await clearRuntimeCaches();
  t.after(clearToolEnv);

  const tools = await loadToolRegistry();
  const toolNames = [...tools.keys()];

  assert.equal(tools.size, 16);
  assert.deepEqual(new Set(toolNames), new Set(EXPECTED_TOOL_NAMES));

  for (const { definition } of tools.values()) {
    assert.equal(definition.annotations?.readOnlyHint, true);
    assert.equal(typeof definition.description, "string");
    assert.equal(typeof definition.inputSchema, "object");
  }

  for (const [name, { definition }] of tools.entries()) {
    assert.equal(
      "force_refresh" in definition.inputSchema,
      EXPECTED_CACHED_TOOL_NAMES.includes(name),
      `${name} force_refresh exposure should match cache policy`
    );
  }

  assert.match(
    tools.get("check_security").definition.description,
    /single-domain tool/i
  );
  assert.match(
    tools.get("get_abuse_contact").definition.description,
    /single-domain tool/i
  );
  assert.match(
    tools.get("lookup_company").definition.description,
    /single-domain tool/i
  );
  assert.match(
    tools.get("lookup_asn").definition.description,
    /call lookup_asn once per ASN\/IP target/i
  );

  const bulkLookupIpsSchema = tools.get("bulk_lookup_ip").definition.inputSchema.ips;
  const bulkSecurityIpsSchema =
    tools.get("bulk_security_check").definition.inputSchema.ips;
  const bulkUaSchema =
    tools.get("bulk_parse_user_agent").definition.inputSchema.uaStrings;

  const validIps = Array.from(
    { length: 1000 },
    (_, index) => `203.0.113.${(index % 254) + 1}`
  );
  const invalidIps = [...validIps, "203.0.113.9"];

  assert.equal(bulkLookupIpsSchema.safeParse(validIps).success, true);
  assert.equal(bulkLookupIpsSchema.safeParse(invalidIps).success, false);
  assert.equal(bulkSecurityIpsSchema.safeParse(validIps).success, true);
  assert.equal(bulkSecurityIpsSchema.safeParse(invalidIps).success, false);

  const validUa = Array.from({ length: 1000 }, (_, index) => `UA-${index}`);
  const invalidUa = [...validUa, "UA-over-limit"];
  assert.equal(bulkUaSchema.safeParse(validUa).success, true);
  assert.equal(bulkUaSchema.safeParse(invalidUa).success, false);
});

test("executes all 16 tools with mocked upstream responses", async (t) => {
  clearToolEnv();
  process.env.IPGEOLOCATION_API_KEY = "test_api_key_local";
  await clearRuntimeCaches();
  const originalFetch = globalThis.fetch;
  const { calls, fetchStub } = createFetchStub();
  globalThis.fetch = fetchStub;
  t.after(() => {
    clearToolEnv();
    globalThis.fetch = originalFetch;
  });

  const tools = await loadToolRegistry();

  const lookupIp = await invoke(tools, "lookup_ip", { ip: "8.8.8.8" });
  assert.equal(lookupIp.isError, undefined);
  assert.equal(JSON.parse(parseTextResult(lookupIp)).ip, "8.8.8.8");

  const bulkLookup = await invoke(tools, "bulk_lookup_ip", {
    ips: ["8.8.8.8", "1.1.1.1"],
  });
  assert.equal(JSON.parse(parseTextResult(bulkLookup)).length, 2);

  const myIp = await invoke(tools, "get_my_ip");
  assert.equal(parseTextResult(myIp), "198.51.100.20");

  const lookupCompany = await invoke(tools, "lookup_company", {
    ip: "1.1.1.1",
  });
  assert.equal(lookupCompany.isError, undefined);
  const parsedCompany = JSON.parse(parseTextResult(lookupCompany));
  assert.ok(parsedCompany.company || parsedCompany.asn);
  const companyCall = calls.at(-1);
  assert.equal(companyCall.url.pathname, "/v3/ipgeo");
  assert.equal(companyCall.url.searchParams.get("fields"), null);

  const lookupCurrency = await invoke(tools, "lookup_currency", { ip: "8.8.4.4" });
  assert.equal(lookupCurrency.isError, undefined);
  const parsedCurrency = JSON.parse(parseTextResult(lookupCurrency));
  assert.ok(parsedCurrency.currency);
  assert.ok(parsedCurrency.country_metadata);
  const currencyCall = calls.at(-1);
  assert.equal(currencyCall.url.searchParams.get("fields"), null);

  const lookupNetwork = await invoke(tools, "lookup_network", { ip: "9.9.9.9" });
  assert.equal(lookupNetwork.isError, undefined);
  const parsedNetwork = JSON.parse(parseTextResult(lookupNetwork));
  assert.ok(parsedNetwork.network || Object.keys(parsedNetwork).length > 0);
  const networkCall = calls.at(-1);
  assert.equal(networkCall.url.searchParams.get("fields"), null);

  await invoke(tools, "check_security", { ip: "8.8.8.8" });
  await invoke(tools, "bulk_security_check", {
    ips: ["8.8.8.8", "1.1.1.1"],
  });
  await invoke(tools, "get_timezone", { tz: "UTC" });
  await invoke(tools, "convert_timezone", { tz_from: "UTC", tz_to: "Asia/Karachi" });
  const astronomy = await invoke(tools, "get_astronomy", {
    location: "Karachi, PK",
    date: "2026-03-05",
  });
  const astronomyData = JSON.parse(parseTextResult(astronomy));
  assert.equal(astronomyData.location.city, "Karachi");
  assert.equal(astronomyData.astronomy.sunrise, "06:00");

  const astronomySeries = await invoke(tools, "get_astronomy_time_series", {
    location: "Karachi, PK",
    dateStart: "2026-03-01",
    dateEnd: "2026-03-05",
  });
  const astronomySeriesData = JSON.parse(parseTextResult(astronomySeries));
  assert.equal(astronomySeriesData.location.city, "Karachi");
  assert.equal(Array.isArray(astronomySeriesData.astronomy), true);
  assert.equal(astronomySeriesData.astronomy.length, 2);
  await invoke(tools, "lookup_asn", { asn: "AS13335" });
  await invoke(tools, "get_abuse_contact", { ip: "8.8.8.8" });
  await invoke(tools, "parse_user_agent", { uaString: "Mozilla/5.0 Test" });
  await invoke(tools, "bulk_parse_user_agent", {
    uaStrings: ["UA-1", "UA-2"],
  });

  const apiCalls = calls.filter((call) => call.url.pathname !== "/v3/getip");
  assert.ok(apiCalls.length > 0, "expected API calls with authentication");
  for (const call of apiCalls) {
    assert.equal(call.url.searchParams.get("apiKey"), "test_api_key_local");
  }
});

test("avoids repeat upstream calls when only fields/excludes change for same ASN, security, and abuse target", async (t) => {
  clearToolEnv();
  process.env.IPGEOLOCATION_API_KEY = "test_api_key_local";
  await clearRuntimeCaches();
  const originalFetch = globalThis.fetch;
  const { calls, fetchStub } = createFetchStub();
  globalThis.fetch = fetchStub;
  t.after(() => {
    clearToolEnv();
    globalThis.fetch = originalFetch;
  });

  const tools = await loadToolRegistry();

  await invoke(tools, "lookup_asn", {
    asn: "AS13335",
    include: "upstreams",
  });
  const filteredAsn = await invoke(tools, "lookup_asn", {
    asn: "AS13335",
    include: "upstreams",
    fields: "asn.upstreams.as_number",
  });
  const excludedAsn = await invoke(tools, "lookup_asn", {
    asn: "AS13335",
    include: "upstreams",
    excludes: "asn.upstreams.description,asn.upstreams.country",
  });

  const asnCalls = calls.filter((call) => call.url.pathname === "/v3/asn");
  assert.equal(asnCalls.length, 1);

  const filteredAsnData = JSON.parse(parseTextResult(filteredAsn));
  assert.ok(Array.isArray(filteredAsnData.asn?.upstreams));
  for (const upstream of filteredAsnData.asn.upstreams) {
    assert.deepEqual(Object.keys(upstream), ["as_number"]);
  }

  const excludedAsnData = JSON.parse(parseTextResult(excludedAsn));
  for (const upstream of excludedAsnData.asn.upstreams) {
    assert.equal("description" in upstream, false);
    assert.equal("country" in upstream, false);
  }

  await invoke(tools, "check_security", { ip: "8.8.8.8" });
  const filteredSecurity = await invoke(tools, "check_security", {
    ip: "8.8.8.8",
    fields: "security.threat_score,security.is_vpn",
  });
  await invoke(tools, "check_security", {
    ip: "8.8.8.8",
    excludes: "security.proxy_provider_names",
  });

  const securityCalls = calls.filter((call) => call.url.pathname === "/v3/security");
  assert.equal(securityCalls.length, 1);

  const filteredSecurityData = JSON.parse(parseTextResult(filteredSecurity));
  assert.deepEqual(
    Object.keys(filteredSecurityData.security).sort(),
    ["is_vpn", "threat_score"]
  );

  await invoke(tools, "get_abuse_contact", { ip: "8.8.8.8" });
  const filteredAbuse = await invoke(tools, "get_abuse_contact", {
    ip: "8.8.8.8",
    fields: "emails,organization",
  });
  await invoke(tools, "get_abuse_contact", {
    ip: "8.8.8.8",
    excludes: "phone_numbers,address",
  });

  const abuseCalls = calls.filter((call) => call.url.pathname === "/v3/abuse");
  assert.equal(abuseCalls.length, 1);

  const filteredAbuseData = JSON.parse(parseTextResult(filteredAbuse));
  assert.deepEqual(
    Object.keys(filteredAbuseData.abuse).sort(),
    ["emails", "organization"]
  );
});

test("auto-adds required include modules when projection fields reference include-only data", async (t) => {
  clearToolEnv();
  process.env.IPGEOLOCATION_API_KEY = "test_api_key_local";
  await clearRuntimeCaches();
  const originalFetch = globalThis.fetch;
  const { calls, fetchStub } = createFetchStub();
  globalThis.fetch = fetchStub;
  t.after(() => {
    clearToolEnv();
    globalThis.fetch = originalFetch;
  });

  const tools = await loadToolRegistry();

  const ipResult = await invoke(tools, "lookup_ip", {
    ip: "8.8.8.8",
    fields: "company,security.threat_score,abuse.emails",
  });
  const parsedIp = JSON.parse(parseTextResult(ipResult));
  assert.ok(parsedIp.company);
  assert.equal(typeof parsedIp.security?.threat_score, "number");
  assert.ok(Array.isArray(parsedIp.abuse?.emails));

  const ipgeoCall = calls.find((call) => call.url.pathname === "/v3/ipgeo");
  assert.ok(ipgeoCall, "lookup_ip should call /v3/ipgeo");
  const ipgeoInclude = new Set(
    (ipgeoCall.url.searchParams.get("include") || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
  );
  assert.equal(ipgeoInclude.has("security"), true);
  assert.equal(ipgeoInclude.has("abuse"), true);

  const asnResult = await invoke(tools, "lookup_asn", {
    asn: "AS13335",
    fields: "upstreams.as_number",
  });
  const parsedAsn = JSON.parse(parseTextResult(asnResult));
  assert.ok(Array.isArray(parsedAsn.asn?.upstreams));
  assert.equal(parsedAsn.asn.upstreams.length > 0, true);

  const asnCall = calls.find((call) => call.url.pathname === "/v3/asn");
  assert.ok(asnCall, "lookup_asn should call /v3/asn");
  assert.equal(asnCall.url.searchParams.get("include"), "upstreams");
});

test("reuses include-path lookup_ip cache for projected follow-up requests", async (t) => {
  clearToolEnv();
  process.env.IPGEOLOCATION_API_KEY = "test_api_key_local";
  await clearRuntimeCaches();
  const originalFetch = globalThis.fetch;
  const { calls, fetchStub } = createFetchStub();
  globalThis.fetch = fetchStub;
  t.after(() => {
    clearToolEnv();
    globalThis.fetch = originalFetch;
  });

  const tools = await loadToolRegistry();

  await invoke(tools, "lookup_ip", {
    ip: "8.8.8.8",
    include: "security,abuse",
  });
  const projected = await invoke(tools, "lookup_ip", {
    ip: "8.8.8.8",
    include: "abuse,security",
    fields: "company,security.threat_score,abuse.emails",
  });

  const ipgeoCalls = calls.filter((call) => call.url.pathname === "/v3/ipgeo");
  assert.equal(ipgeoCalls.length, 1);

  const projectedData = JSON.parse(parseTextResult(projected));
  assert.equal(typeof projectedData.security?.threat_score, "number");
  assert.ok(Array.isArray(projectedData.abuse?.emails));
  assert.ok(projectedData.company);
});

test("force_refresh bypasses cache for cached tools", async (t) => {
  clearToolEnv();
  process.env.IPGEOLOCATION_API_KEY = "test_api_key_local";
  await clearRuntimeCaches();
  const originalFetch = globalThis.fetch;
  const { calls, fetchStub } = createFetchStub();
  globalThis.fetch = fetchStub;
  t.after(() => {
    clearToolEnv();
    globalThis.fetch = originalFetch;
  });

  const tools = await loadToolRegistry();

  await invoke(tools, "lookup_ip", { ip: "1.1.1.1" });
  await invoke(tools, "lookup_ip", { ip: "1.1.1.1" });
  await invoke(tools, "lookup_ip", { ip: "1.1.1.1", force_refresh: true });
  const ipgeoCalls = calls.filter((call) => call.url.pathname === "/v3/ipgeo");
  assert.equal(ipgeoCalls.length, 2);

  await invoke(tools, "lookup_asn", { asn: "AS13335", include: "upstreams" });
  await invoke(tools, "lookup_asn", { asn: "AS13335", include: "upstreams" });
  await invoke(tools, "lookup_asn", {
    asn: "AS13335",
    include: "upstreams",
    force_refresh: true,
  });
  const asnCalls = calls.filter((call) => call.url.pathname === "/v3/asn");
  assert.equal(asnCalls.length, 2);

  await invoke(tools, "check_security", { ip: "8.8.8.8" });
  await invoke(tools, "check_security", { ip: "8.8.8.8" });
  await invoke(tools, "check_security", {
    ip: "8.8.8.8",
    force_refresh: true,
  });
  const securityCalls = calls.filter((call) => call.url.pathname === "/v3/security");
  assert.equal(securityCalls.length, 2);

  await invoke(tools, "get_abuse_contact", { ip: "8.8.8.8" });
  await invoke(tools, "get_abuse_contact", { ip: "8.8.8.8" });
  await invoke(tools, "get_abuse_contact", {
    ip: "8.8.8.8",
    force_refresh: true,
  });
  const abuseCalls = calls.filter((call) => call.url.pathname === "/v3/abuse");
  assert.equal(abuseCalls.length, 2);

  await invoke(tools, "bulk_lookup_ip", { ips: ["8.8.8.8", "1.1.1.1"] });
  await invoke(tools, "bulk_lookup_ip", { ips: ["8.8.8.8", "1.1.1.1"] });
  await invoke(tools, "bulk_lookup_ip", {
    ips: ["8.8.8.8", "1.1.1.1"],
    force_refresh: true,
  });
  const bulkIpgeoCalls = calls.filter((call) => call.url.pathname === "/v3/ipgeo-bulk");
  assert.equal(bulkIpgeoCalls.length, 2);

  await invoke(tools, "bulk_security_check", { ips: ["8.8.8.8", "1.1.1.1"] });
  await invoke(tools, "bulk_security_check", { ips: ["8.8.8.8", "1.1.1.1"] });
  await invoke(tools, "bulk_security_check", {
    ips: ["8.8.8.8", "1.1.1.1"],
    force_refresh: true,
  });
  const bulkSecurityCalls = calls.filter(
    (call) => call.url.pathname === "/v3/security-bulk"
  );
  assert.equal(bulkSecurityCalls.length, 2);

  await invoke(tools, "get_astronomy_time_series", {
    location: "Karachi, PK",
    dateStart: "2026-03-01",
    dateEnd: "2026-03-05",
  });
  await invoke(tools, "get_astronomy_time_series", {
    location: "Karachi, PK",
    dateStart: "2026-03-01",
    dateEnd: "2026-03-05",
  });
  await invoke(tools, "get_astronomy_time_series", {
    location: "Karachi, PK",
    dateStart: "2026-03-01",
    dateEnd: "2026-03-05",
    force_refresh: true,
  });
  const astronomySeriesCalls = calls.filter(
    (call) => call.url.pathname === "/v3/astronomy/timeSeries"
  );
  assert.equal(astronomySeriesCalls.length, 2);

  await invoke(tools, "parse_user_agent", {
    uaString: "Mozilla/5.0 Test",
  });
  await invoke(tools, "parse_user_agent", {
    uaString: "Mozilla/5.0 Test",
  });
  await invoke(tools, "parse_user_agent", {
    uaString: "Mozilla/5.0 Test",
    force_refresh: true,
  });
  const userAgentCalls = calls.filter((call) => call.url.pathname === "/v3/user-agent");
  assert.equal(userAgentCalls.length, 2);

  await invoke(tools, "bulk_parse_user_agent", {
    uaStrings: ["UA-1", "UA-2"],
  });
  await invoke(tools, "bulk_parse_user_agent", {
    uaStrings: ["UA-1", "UA-2"],
  });
  await invoke(tools, "bulk_parse_user_agent", {
    uaStrings: ["UA-1", "UA-2"],
    force_refresh: true,
  });
  const bulkUserAgentCalls = calls.filter(
    (call) => call.url.pathname === "/v3/user-agent-bulk"
  );
  assert.equal(bulkUserAgentCalls.length, 2);
});

test("time-sensitive tools do not cache repeated calls", async (t) => {
  clearToolEnv();
  process.env.IPGEOLOCATION_API_KEY = "test_api_key_local";
  await clearRuntimeCaches();
  const originalFetch = globalThis.fetch;
  const { calls, fetchStub } = createFetchStub();
  globalThis.fetch = fetchStub;
  t.after(() => {
    clearToolEnv();
    globalThis.fetch = originalFetch;
  });

  const tools = await loadToolRegistry();

  await invoke(tools, "get_my_ip");
  await invoke(tools, "get_my_ip");
  const getMyIpCalls = calls.filter((call) => call.url.pathname === "/v3/getip");
  assert.equal(getMyIpCalls.length, 2);

  await invoke(tools, "get_timezone", { tz: "UTC" });
  await invoke(tools, "get_timezone", { tz: "UTC" });
  const timezoneCalls = calls.filter((call) => call.url.pathname === "/v3/timezone");
  assert.equal(timezoneCalls.length, 2);

  await invoke(tools, "convert_timezone", {
    tz_from: "UTC",
    tz_to: "Asia/Karachi",
  });
  await invoke(tools, "convert_timezone", {
    tz_from: "UTC",
    tz_to: "Asia/Karachi",
  });
  const convertTimezoneCalls = calls.filter(
    (call) => call.url.pathname === "/v3/timezone/convert"
  );
  assert.equal(convertTimezoneCalls.length, 2);

  await invoke(tools, "get_astronomy", {
    location: "Karachi, PK",
    date: "2026-03-05",
  });
  await invoke(tools, "get_astronomy", {
    location: "Karachi, PK",
    date: "2026-03-05",
  });
  const astronomyCalls = calls.filter((call) => call.url.pathname === "/v3/astronomy");
  assert.equal(astronomyCalls.length, 2);
});

test("reuses base ipgeo result across convenience tools and lookup_ip field projections", async (t) => {
  clearToolEnv();
  process.env.IPGEOLOCATION_API_KEY = "test_api_key_local";
  await clearRuntimeCaches();
  const originalFetch = globalThis.fetch;
  const { calls, fetchStub } = createFetchStub();
  globalThis.fetch = fetchStub;
  t.after(() => {
    clearToolEnv();
    globalThis.fetch = originalFetch;
  });

  const tools = await loadToolRegistry();

  await invoke(tools, "lookup_company", { ip: "1.1.1.1" });
  const projectedLookup = await invoke(tools, "lookup_ip", {
    ip: "1.1.1.1",
    fields: "location.city,company,asn",
  });
  await invoke(tools, "lookup_currency", { ip: "1.1.1.1" });
  await invoke(tools, "lookup_network", { ip: "1.1.1.1" });

  const ipgeoCalls = calls.filter((call) => call.url.pathname === "/v3/ipgeo");
  assert.equal(ipgeoCalls.length, 1);

  const projectedData = JSON.parse(parseTextResult(projectedLookup));
  assert.equal(projectedData.location.city, "Test City");
  assert.ok(projectedData.company);
  assert.ok(projectedData.asn);
  assert.equal(projectedData.currency, undefined);
});

test("validates timezone and astronomy inputs before network calls", async (t) => {
  clearToolEnv();
  process.env.IPGEOLOCATION_API_KEY = "test_api_key_local";
  await clearRuntimeCaches();
  const originalFetch = globalThis.fetch;
  const { calls, fetchStub } = createFetchStub();
  globalThis.fetch = fetchStub;
  t.after(() => {
    clearToolEnv();
    globalThis.fetch = originalFetch;
  });

  const tools = await loadToolRegistry();

  const beforeCalls = calls.length;
  const timezoneError = await invoke(tools, "get_timezone", { lat: "40.7" });
  assert.equal(timezoneError.isError, true);
  assert.match(parseTextResult(timezoneError), /lat.*long.*provided together/);
  assert.equal(calls.length, beforeCalls);

  const conversionError = await invoke(tools, "convert_timezone", {
    tz_from: "UTC",
  });
  assert.equal(conversionError.isError, true);
  assert.match(parseTextResult(conversionError), /destination selector/);
  assert.equal(calls.length, beforeCalls);

  const astronomyDateError = await invoke(tools, "get_astronomy", {
    location: "Karachi, PK",
    date: "20260305",
  });
  assert.equal(astronomyDateError.isError, true);
  assert.match(parseTextResult(astronomyDateError), /YYYY-MM-DD/);
  assert.equal(calls.length, beforeCalls);

  const astronomyRangeError = await invoke(tools, "get_astronomy_time_series", {
    location: "Karachi, PK",
    dateStart: "2026-01-01",
    dateEnd: "2026-05-01",
  });
  assert.equal(astronomyRangeError.isError, true);
  assert.match(parseTextResult(astronomyRangeError), /maximum allowed range/);
  assert.equal(calls.length, beforeCalls);

  const timezoneValueError = await invoke(tools, "get_timezone", {
    lat: "91",
    long: "74.3",
  });
  assert.equal(timezoneValueError.isError, true);
  assert.match(parseTextResult(timezoneValueError), /between -90 and 90/);
  assert.equal(calls.length, beforeCalls);

  const conversionTimeError = await invoke(tools, "convert_timezone", {
    tz_from: "UTC",
    tz_to: "Asia/Karachi",
    time: "2026-03-05T10:00:00",
  });
  assert.equal(conversionTimeError.isError, true);
  assert.match(parseTextResult(conversionTimeError), /yyyy-MM-dd HH:mm/);
  assert.equal(calls.length, beforeCalls);

  const elevationError = await invoke(tools, "get_astronomy", {
    location: "Karachi, PK",
    elevation: "-1",
  });
  assert.equal(elevationError.isError, true);
  assert.match(parseTextResult(elevationError), /between 0 and 10000/);
  assert.equal(calls.length, beforeCalls);
});

test("truncates oversized bulk results and oversized errors", async (t) => {
  clearToolEnv();
  process.env.IPGEOLOCATION_API_KEY = "test_api_key_local";
  await clearRuntimeCaches();
  const originalFetch = globalThis.fetch;
  const { fetchStub } = createFetchStub();
  globalThis.fetch = fetchStub;
  t.after(() => {
    clearToolEnv();
    globalThis.fetch = originalFetch;
  });

  const tools = await loadToolRegistry();

  const bulkIps = Array.from({ length: 300 }, (_, i) => `203.0.113.${(i % 254) + 1}`);
  const bulkResponse = await invoke(tools, "bulk_security_check", { ips: bulkIps });
  assert.equal(bulkResponse.isError, undefined);
  const parsedBulk = JSON.parse(parseTextResult(bulkResponse));
  assert.equal(parsedBulk.truncated, true);
  assert.equal(parsedBulk.total_items, 300);
  assert.equal(parsedBulk.shown_items, 250);
  assert.equal(parsedBulk.items.length, 250);

  const errorResponse = await invoke(tools, "lookup_asn", { asn: "AS_ERROR" });
  assert.equal(errorResponse.isError, true);
  const errorText = parseTextResult(errorResponse);
  assert.ok(errorText.length < 4200);
  assert.match(errorText, /truncated/i);
});
