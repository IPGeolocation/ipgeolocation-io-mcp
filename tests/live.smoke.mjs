import assert from "node:assert/strict";

class ToolRegistryServer {
  constructor() {
    this.tools = new Map();
  }

  registerTool(name, definition, handler) {
    this.tools.set(name, { definition, handler });
  }
}

function distModuleUrl(relativePath) {
  return new URL(`../dist/${relativePath}`, import.meta.url).href;
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
    cache,
  ] = await Promise.all([
    import(distModuleUrl("tools/geolocation.js")),
    import(distModuleUrl("tools/security.js")),
    import(distModuleUrl("tools/timezone.js")),
    import(distModuleUrl("tools/astronomy.js")),
    import(distModuleUrl("tools/asn.js")),
    import(distModuleUrl("tools/abuse.js")),
    import(distModuleUrl("tools/useragent.js")),
    import(distModuleUrl("tools/cache.js")),
  ]);

  cache.clearToolCacheForTests();

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

async function invoke(tools, name, args = {}) {
  const tool = tools.get(name);
  assert.ok(tool, `tool '${name}' should be registered`);
  const result = await tool.handler(args);
  assert.equal(result.isError, undefined, `${name} should not return an error`);
  assert.ok(result.content?.length, `${name} should return content`);
  assert.equal(result.content[0].type, "text");
  return result.content[0].text;
}

async function invokeJson(tools, name, args = {}) {
  return JSON.parse(await invoke(tools, name, args));
}

function isIpAddress(value) {
  return typeof value === "string" && /[.:]/.test(value);
}

async function runCheck(name, run) {
  try {
    await run();
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`FAIL ${name}: ${message}`);
    return false;
  }
}

async function runFreeChecks(tools) {
  const results = [];

  results.push(
    await runCheck("get_my_ip", async () => {
      const ip = await invoke(tools, "get_my_ip");
      assert.equal(isIpAddress(ip), true);
    })
  );

  results.push(
    await runCheck("lookup_ip", async () => {
      const data = await invokeJson(tools, "lookup_ip", {
        ip: "8.8.8.8",
        fields: "ip,location.city,location.country_name,asn",
        force_refresh: true,
      });
      assert.equal(data.ip, "8.8.8.8");
      assert.equal(typeof data.location?.country_name, "string");
      assert.ok(data.asn);
    })
  );

  results.push(
    await runCheck("lookup_currency", async () => {
      const data = await invokeJson(tools, "lookup_currency", {
        ip: "8.8.8.8",
        force_refresh: true,
      });
      assert.equal(typeof data.currency?.code, "string");
      assert.equal(typeof data.country_metadata?.tld, "string");
    })
  );

  results.push(
    await runCheck("get_timezone", async () => {
      const data = await invokeJson(tools, "get_timezone", {
        location: "Tokyo",
      });
      assert.equal(typeof data.time_zone?.name, "string");
      assert.ok(data.time_zone?.current_time || data.time_zone?.date_time);
    })
  );

  results.push(
    await runCheck("convert_timezone", async () => {
      const data = await invokeJson(tools, "convert_timezone", {
        time: "2026-03-10 09:30",
        tz_from: "America/New_York",
        tz_to: "Asia/Tokyo",
      });
      assert.ok(
        data.converted_time || data.time_to || data.date_time_to || data.to,
        "expected a converted time field"
      );
      assert.ok(
        data.original_time || data.time_from || data.date_time_from || data.from,
        "expected an original time field"
      );
    })
  );

  results.push(
    await runCheck("get_astronomy", async () => {
      const data = await invokeJson(tools, "get_astronomy", {
        location: "Karachi, PK",
        date: "2026-03-10",
      });
      assert.equal(typeof data.location?.country_name, "string");
      assert.ok(data.astronomy?.sunrise);
      assert.ok(data.astronomy?.sunset);
    })
  );

  results.push(
    await runCheck("get_astronomy_time_series", async () => {
      const data = await invokeJson(tools, "get_astronomy_time_series", {
        location: "Karachi, PK",
        dateStart: "2026-03-10",
        dateEnd: "2026-03-12",
        force_refresh: true,
      });
      assert.ok(Array.isArray(data.astronomy));
      assert.ok(data.astronomy.length >= 1);
    })
  );

  return results.every(Boolean);
}

async function runPaidChecks(tools) {
  const userAgentA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
  const userAgentB =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

  const results = [];

  results.push(
    await runCheck("lookup_ip with include", async () => {
      const data = await invokeJson(tools, "lookup_ip", {
        ip: "49.12.212.42",
        fields: "ip,location.city,company,asn,security,abuse",
        force_refresh: true,
      });
      assert.equal(data.ip, "49.12.212.42");
      assert.ok(data.company);
      assert.ok(data.asn);
      assert.ok(data.security);
      assert.ok(data.abuse);
    })
  );

  results.push(
    await runCheck("bulk_lookup_ip", async () => {
      const data = await invokeJson(tools, "bulk_lookup_ip", {
        ips: ["8.8.8.8", "1.1.1.1"],
        fields: "ip,location.country_name",
        force_refresh: true,
      });
      assert.ok(Array.isArray(data));
      assert.equal(data.length, 2);
    })
  );

  results.push(
    await runCheck("lookup_company", async () => {
      const data = await invokeJson(tools, "lookup_company", {
        ip: "49.12.212.42",
        force_refresh: true,
      });
      assert.ok(data.company || data.asn);
    })
  );

  results.push(
    await runCheck("lookup_network", async () => {
      const data = await invokeJson(tools, "lookup_network", {
        ip: "49.12.212.42",
        force_refresh: true,
      });
      assert.ok(data.network);
    })
  );

  results.push(
    await runCheck("check_security", async () => {
      const data = await invokeJson(tools, "check_security", {
        ip: "49.12.212.42",
        force_refresh: true,
      });
      assert.equal(typeof data.security?.threat_score, "number");
    })
  );

  results.push(
    await runCheck("bulk_security_check", async () => {
      const data = await invokeJson(tools, "bulk_security_check", {
        ips: ["49.12.212.42", "2.56.12.11"],
        force_refresh: true,
      });
      assert.ok(Array.isArray(data));
      assert.equal(data.length, 2);
    })
  );

  results.push(
    await runCheck("lookup_asn", async () => {
      const data = await invokeJson(tools, "lookup_asn", {
        asn: "AS24940",
        include: "upstreams",
        force_refresh: true,
      });
      assert.ok(data.asn);
      assert.ok(Array.isArray(data.asn.upstreams));
    })
  );

  results.push(
    await runCheck("get_abuse_contact", async () => {
      const data = await invokeJson(tools, "get_abuse_contact", {
        ip: "1.1.1.1",
        force_refresh: true,
      });
      assert.ok(data.abuse);
      assert.ok(
        data.abuse.emails || data.abuse.phone_numbers || data.abuse.address
      );
    })
  );

  results.push(
    await runCheck("parse_user_agent", async () => {
      const data = await invokeJson(tools, "parse_user_agent", {
        uaString: userAgentA,
        force_refresh: true,
      });
      assert.equal(typeof data.name, "string");
      assert.equal(typeof data.type, "string");
    })
  );

  results.push(
    await runCheck("bulk_parse_user_agent", async () => {
      const data = await invokeJson(tools, "bulk_parse_user_agent", {
        uaStrings: [userAgentA, userAgentB],
        force_refresh: true,
      });
      assert.ok(Array.isArray(data));
      assert.equal(data.length, 2);
    })
  );

  return results.every(Boolean);
}

async function main() {
  const mode = process.argv[2];
  const keyEnvName =
    mode === "free"
      ? "IPGEOLOCATION_FREE_KEY"
      : mode === "paid"
        ? "IPGEOLOCATION_PAID_KEY"
        : undefined;

  if (!keyEnvName) {
    console.error("Usage: node tests/live.smoke.mjs <free|paid>");
    process.exit(1);
  }

  const apiKey = process.env[keyEnvName];
  if (!apiKey) {
    console.error(`${keyEnvName} is required for ${mode} live smoke tests.`);
    process.exit(1);
  }

  process.env.IPGEOLOCATION_API_KEY = apiKey;

  console.log(`Running ${mode} live smoke tests. Real API credits will be used.`);
  const tools = await loadToolRegistry();
  const ok = mode === "free" ? await runFreeChecks(tools) : await runPaidChecks(tools);

  if (!ok) {
    process.exit(1);
  }

  console.log(`All ${mode} live smoke checks passed.`);
}

await main();
