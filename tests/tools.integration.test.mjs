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

class FakeServer {
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

  const server = new FakeServer();
  geolocation.registerGeolocationTools(server);
  security.registerSecurityTools(server);
  timezone.registerTimezoneTools(server);
  astronomy.registerAstronomyTools(server);
  asn.registerAsnTools(server);
  abuse.registerAbuseTools(server);
  userAgent.registerUserAgentTools(server);
  return server.tools;
}

function createMockFetch() {
  const calls = [];

  async function fetchMock(input, init = {}) {
    const url = new URL(String(input));
    const method = (init.method || "GET").toUpperCase();
    const rawBody = typeof init.body === "string" ? init.body : undefined;
    const body = rawBody ? JSON.parse(rawBody) : undefined;

    calls.push({ url, method, body, rawBody });

    switch (url.pathname) {
      case "/v3/getip":
        return jsonResponse({ ip: "198.51.100.20" });
      case "/v3/ipgeo":
        return jsonResponse({
          endpoint: "ipgeo",
          ip: url.searchParams.get("ip") || "self",
          fields: url.searchParams.get("fields"),
        });
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
          security: { threat_score: 0, is_vpn: false },
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
          timezone: { name: "UTC", current_time: "2026-03-05 00:00:00" },
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
          date: url.searchParams.get("date") || "2026-03-05",
          sunrise: "06:00",
          sunset: "18:00",
        });
      case "/v3/astronomy/timeSeries":
        return jsonResponse([
          { date: url.searchParams.get("dateStart"), sunrise: "06:00" },
          { date: url.searchParams.get("dateEnd"), sunrise: "06:01" },
        ]);
      case "/v3/asn":
        if (url.searchParams.get("asn") === "AS_ERROR") {
          return new Response("e".repeat(9000), {
            status: 500,
            statusText: "Internal Server Error",
          });
        }
        return jsonResponse({ asn: { as_number: "AS13335" } });
      case "/v3/abuse":
        return jsonResponse({
          abuse: { emails: ["abuse@example.com"], organization: "Example ISP" },
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

  return { calls, fetchMock };
}

async function invoke(tools, name, args = {}) {
  const tool = tools.get(name);
  assert.ok(tool, `Tool '${name}' should be registered`);
  return tool.handler(args);
}

test("registers all MCP tools with expected metadata", async (t) => {
  clearToolEnv();
  process.env.IPGEOLOCATION_API_KEY = "unit-test-key";
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
  process.env.IPGEOLOCATION_API_KEY = "unit-test-key";
  const originalFetch = globalThis.fetch;
  const { calls, fetchMock } = createMockFetch();
  globalThis.fetch = fetchMock;
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
  const companyCall = calls.at(-1);
  assert.equal(companyCall.url.pathname, "/v3/ipgeo");
  assert.equal(companyCall.url.searchParams.get("fields"), "company,asn");

  await invoke(tools, "lookup_currency", { ip: "8.8.4.4" });
  const currencyCall = calls.at(-1);
  assert.equal(
    currencyCall.url.searchParams.get("fields"),
    "currency,country_metadata"
  );

  await invoke(tools, "lookup_network", { ip: "9.9.9.9" });
  const networkCall = calls.at(-1);
  assert.equal(networkCall.url.searchParams.get("fields"), "network");

  await invoke(tools, "check_security", { ip: "8.8.8.8" });
  await invoke(tools, "bulk_security_check", {
    ips: ["8.8.8.8", "1.1.1.1"],
  });
  await invoke(tools, "get_timezone", { tz: "UTC" });
  await invoke(tools, "convert_timezone", { tz_from: "UTC", tz_to: "Asia/Karachi" });
  await invoke(tools, "get_astronomy", { location: "Karachi, PK", date: "2026-03-05" });
  await invoke(tools, "get_astronomy_time_series", {
    location: "Karachi, PK",
    dateStart: "2026-03-01",
    dateEnd: "2026-03-05",
  });
  await invoke(tools, "lookup_asn", { asn: "AS13335" });
  await invoke(tools, "get_abuse_contact", { ip: "8.8.8.8" });
  await invoke(tools, "parse_user_agent", { uaString: "Mozilla/5.0 Test" });
  await invoke(tools, "bulk_parse_user_agent", {
    uaStrings: ["UA-1", "UA-2"],
  });

  const apiCalls = calls.filter((call) => call.url.pathname !== "/v3/getip");
  assert.ok(apiCalls.length > 0, "expected API calls with authentication");
  for (const call of apiCalls) {
    assert.equal(call.url.searchParams.get("apiKey"), "unit-test-key");
  }
});

test("validates timezone and astronomy inputs before network calls", async (t) => {
  clearToolEnv();
  process.env.IPGEOLOCATION_API_KEY = "unit-test-key";
  const originalFetch = globalThis.fetch;
  const { calls, fetchMock } = createMockFetch();
  globalThis.fetch = fetchMock;
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
});

test("truncates oversized bulk results and oversized errors", async (t) => {
  clearToolEnv();
  process.env.IPGEOLOCATION_API_KEY = "unit-test-key";
  const originalFetch = globalThis.fetch;
  const { fetchMock } = createMockFetch();
  globalThis.fetch = fetchMock;
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
