import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

async function invoke(tools, name, args = {}) {
  const result = await tools.callTool({ name, arguments: args });
  assert.equal(result.isError, undefined, `${name} should not return an error`);
  assert.ok(result.content?.length, `${name} should return content`);
  assert.equal(result.content[0].type, "text");
  assert.ok(result.structuredContent, `${name} should return structured content`);
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

  results.push(await runCheck("cached projections match fresh paid API responses", async () => {
    for (const [include, cases] of [
      ["security", [
        { fields: "location.city" },
        { fields: "security", excludes: "security" },
        { fields: "security.is_vpn", excludes: "security" },
        { fields: "security.is_vpn,security.threat_score", excludes: "security.threat_score" },
        { fields: "location.city", excludes: "location.city" },
      ]],
      ["geo_accuracy,dma_code", [
        { fields: "location.city", excludes: "location" },
        { fields: "location.accuracy_radius,location.dma_code", excludes: "location.accuracy_radius,location.dma_code" },
      ]],
      ["*", [{ fields: "location.city" }, { fields: "security.is_vpn,location.city" }]],
    ]) {
      await invokeJson(tools, "lookup_ip", { ip: "8.8.8.8", include, force_refresh: true });
      for (const projection of cases) {
        const args = { ip: "8.8.8.8", include, ...projection };
        const cached = await invokeJson(tools, "lookup_ip", args);
        const fresh = await invokeJson(tools, "lookup_ip", { ...args, force_refresh: true });
        assert.deepEqual(cached, fresh, `Projection differs for ${JSON.stringify(args)}`);
      }
    }
  }));

  results.push(await runCheck("optional location fields infer includes in single and bulk calls", async () => {
    for (const name of ["lookup_ip", "bulk_lookup_ip"]) {
      const result = await invokeJson(tools, name, {
        ...(name.startsWith("bulk_") ? { ips: ["8.8.8.8"] } : { ip: "8.8.8.8" }),
        fields: "location.accuracy_radius,location.confidence,location.locality,location.dma_code", force_refresh: true,
      });
      const item = Array.isArray(result) ? result[0] : result;
      for (const key of ["accuracy_radius", "confidence", "locality", "dma_code"]) assert.ok(Object.hasOwn(item.location, key), key);
    }
  }));

  results.push(await runCheck("quoted user-agent echoes remain valid redacted JSON", async () => {
    const data = await invokeJson(tools, "parse_user_agent", { uaString: 'Mozilla/5.0 (apiKey="live-qa-placeholder")', force_refresh: true });
    assert.ok(!JSON.stringify(data).includes("live-qa-placeholder"));
    assert.equal(typeof data.user_agent_string, "string");
  }));

  results.push(await runCheck("structured validation before a paid call", async () => {
    const result = await tools.callTool({ name: "check_security", arguments: { ip: false } });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.category, "validation");
    assert.equal(result.structuredContent.error.status, undefined);
  }));

  results.push(await runCheck("structured upstream private-IP error", async () => {
    const result = await tools.callTool({ name: "lookup_ip", arguments: { ip: "10.0.0.1" } });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.source, "ipgeolocation_api");
    assert.equal(result.structuredContent.error.status, 423);
    assert.equal(result.structuredContent.error.retryable, false);
  }));

  for (const name of ["bulk_lookup_ip", "bulk_security_check"]) {
    results.push(await runCheck(`${name} mixed valid/private inputs`, async () => {
      const result = await tools.callTool({ name, arguments: { ips: ["8.8.8.8", "10.0.0.1"], fields: name === "bulk_lookup_ip" ? "location.country_name" : "security.is_vpn" } });
      assert.equal(result.isError, undefined);
      assert.equal(result.structuredContent.items.length, 2);
      const [error] = result.structuredContent.errors;
      assert.equal(error.input, "10.0.0.1");
      assert.equal(error.input_index, 1);
      assert.equal(error.status, undefined);
      assert.equal(error.retryable, false);
    }));
  }

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

async function runFreePlanChecks(tools) {
  const results = [];
  const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36";
  for (const [name, args] of [
    ["check_security", { ip: "8.8.8.8" }],
    ["bulk_security_check", { ips: ["8.8.8.8"] }],
    ["lookup_asn", { asn: "AS15169" }],
    ["get_abuse_contact", { ip: "8.8.8.8" }],
    ["parse_user_agent", { uaString: userAgent }],
    ["bulk_parse_user_agent", { uaStrings: [userAgent] }],
    ["lookup_ip", { ip: "8.8.8.8", include: "security" }],
    ["lookup_ip", { ip: "8.8.8.8", include: "abuse" }],
    ["lookup_ip", { ip: "8.8.8.8", lang: "fr" }],
    ["lookup_ip", { ip: "google.com" }],
  ]) {
    results.push(await runCheck(`free-plan restriction: ${name} ${JSON.stringify(args)}`, async () => {
      const result = await tools.callTool({ name, arguments: args });
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent.error.source, "ipgeolocation_api");
      assert.equal(result.structuredContent.error.status, 401);
      assert.equal(result.structuredContent.error.retryable, false);
    }));
  }
  results.push(await runCheck("free-plan ownership returns basic ASN only", async () => {
    const data = await invokeJson(tools, "lookup_company", { ip: "8.8.8.8" });
    assert.equal(data.asn.as_number, "AS15169");
    assert.equal(data.company, undefined);
  }));
  results.push(await runCheck("free-plan missing network data returns a local error", async () => {
    const result = await tools.callTool({ name: "lookup_network", arguments: { ip: "8.8.8.8" } });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.source, "mcp_server");
    assert.equal(result.structuredContent.error.status, undefined);
    assert.equal(result.structuredContent.error.retryable, false);
    assert.match(result.structuredContent.error.message, /Network data is unavailable/);
  }));
  results.push(await runCheck("free-plan bulk entitlement is represented accurately", async () => {
    const ips = ["8.8.8.8", "1.1.1.1"];
    const result = await tools.callTool({ name: "bulk_lookup_ip", arguments: { ips, fields: "ip,location.country_name" } });
    if (result.isError) {
      assert.equal(result.structuredContent.error.source, "ipgeolocation_api");
      assert.equal(result.structuredContent.error.status, 401);
      assert.equal(result.structuredContent.error.retryable, false);
    } else {
      assert.deepEqual(result.structuredContent.items.map(item => item.ip), ips);
      assert.equal(result.structuredContent.errors.length, 0);
      assert.ok(result.structuredContent.items.every(item => typeof item.location?.country_name === "string"));
      console.log("NOTICE: This free-plan key permits basic bulk geolocation; public API documentation describes bulk as paid-only.");
    }
  }));
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
    console.error("Usage: node tests/live.smoke.mjs <free|paid> [server-command ...args]");
    process.exit(1);
  }

  const apiKey = process.env[keyEnvName];
  if (!apiKey) {
    console.error(`${keyEnvName} is required for ${mode} live smoke tests.`);
    process.exit(1);
  }

  process.env.IPGEOLOCATION_API_KEY = apiKey;

  console.log(`Running ${mode} live smoke tests. Real API credits will be used.`);
  const tools = new Client({ name: "ipgeolocation-live-smoke", version: "1.0.0" });
  const [, , , suppliedCommand, ...suppliedArgs] = process.argv;
  const transport = new StdioClientTransport({
    command: suppliedCommand ?? process.execPath,
    args: suppliedCommand ? suppliedArgs : [fileURLToPath(new URL("../dist/cli.js", import.meta.url))],
    env: { ...process.env, IPGEOLOCATION_API_KEY: apiKey },
    stderr: "pipe",
  });
  let ok;
  try {
    await tools.connect(transport);
    const { tools: listed } = await tools.listTools();
    assert.equal(listed.length, 17);
    assert.ok(listed.every(tool => tool.outputSchema));
    const unknownOk = await runCheck("unknown selectors fail locally", async () => {
      const result = await tools.callTool({ name: "lookup_ip", arguments: { ips: ["8.8.8.8"] } });
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent.error.category, "validation");
      assert.match(result.structuredContent.error.message, /ips/);
    });
    const readerOk = await runCheck("cached-result reader rejects invalid cursors locally", async () => {
      const result = await tools.callTool({ name: "get_cached_result", arguments: { cursor: "invalid-cursor" } });
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent.error.source, "mcp_server");
      assert.equal(result.structuredContent.error.category, "validation");
      assert.equal(result.structuredContent.error.status, undefined);
      assert.equal(result.structuredContent.error.retryable, false);
    });
    const coreOk = await runFreeChecks(tools);
    ok = (mode === "free" ? await runFreePlanChecks(tools) : await runPaidChecks(tools)) && coreOk && readerOk && unknownOk;
  } finally {
    await tools.close();
  }

  if (!ok) {
    process.exit(1);
  }

  console.log(`All ${mode} live smoke checks passed.`);
}

await main();
