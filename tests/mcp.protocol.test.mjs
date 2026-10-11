import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

async function readRepoFile(relativePath) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

test("server entrypoint uses stdio transport and connects MCP server", async () => {
  const indexSource = await readRepoFile("dist/index.js");

  assert.match(indexSource, /StdioServerTransport/);
  assert.match(indexSource, /new StdioServerTransport\(\)/);
  assert.match(indexSource, /await server\.connect\(transport\)/);
  assert.match(indexSource, /process\.stdin\.resume\(\)/);
});

test("server entrypoint has graceful shutdown handlers", async () => {
  const indexSource = await readRepoFile("dist/index.js");

  assert.match(indexSource, /process\.on\("SIGINT"/);
  assert.match(indexSource, /process\.on\("SIGTERM"/);
  assert.match(indexSource, /await server\.close\(\)/);
});

test("server entrypoint includes global tool-selection instructions", async () => {
  const indexSource = await readRepoFile("dist/index.js");

  assert.match(indexSource, /instructions:/);
  assert.match(
    indexSource,
    /If one IP needs two or more IP domains, make one lookup_ip call first/
  );
  assert.match(
    indexSource,
    /Use narrow IP tools .* only for single-domain requests\./
  );
  assert.match(
    indexSource,
    /If the first response is a superset of what is needed, answer from that response and do not call another tool for formatting\./
  );
  assert.match(
    indexSource,
    /For ASN queries, make at most one lookup_asn call per target and include set\./
  );
  assert.match(
    indexSource,
    /Never call the same tool twice for the same target in one answer unless the prior call failed or required data is truly missing\./
  );
  assert.match(indexSource, /Use fields to request only required paths/);
});

test("server runtime version matches package version", async () => {
  const packageJson = JSON.parse(await readRepoFile("package.json"));
  const indexSource = await readRepoFile("dist/index.js");

  assert.match(
    indexSource,
    new RegExp(`version:\\s*"${packageJson.version}"`)
  );
});

test("server entrypoint exports Smithery-compatible config without auto-starting on import", async () => {
  const moduleUrl = new URL("../dist/index.js", import.meta.url);
  moduleUrl.searchParams.set("t", `${Date.now()}-${Math.random()}`);
  const entrypoint = await import(moduleUrl.href);

  assert.equal(typeof entrypoint.default, "function");
  assert.equal(typeof entrypoint.startStdioServer, "function");
  assert.equal(typeof entrypoint.createMcpServer, "function");
  assert.ok(entrypoint.configSchema);

  const validConfig = entrypoint.configSchema.safeParse({
    apiKey: "test-key",
  });
  const invalidConfig = entrypoint.configSchema.safeParse({});
  const emptyApiKeyConfig = entrypoint.configSchema.safeParse({ apiKey: "" });

  assert.equal(validConfig.success, true);
  assert.equal(invalidConfig.success, false);
  assert.equal(emptyApiKeyConfig.success, false);
  assert.ok(entrypoint.default({ config: { apiKey: "test-key" } }));
});

test("package main can run as a stdio server for generic hosts", async () => {
  const packageJson = JSON.parse(await readRepoFile("package.json"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(repoRoot, "dist/index.js")],
    cwd: repoRoot,
    env: {
      IPGEOLOCATION_API_KEY: "test-key",
    },
    stderr: "pipe",
  });
  const client = new Client({
    name: "entrypoint-test",
    version: "1.0.0",
  });

  try {
    await client.connect(transport, { timeout: 5000 });
    assert.deepEqual(client.getServerVersion(), {
      name: "ipgeolocation-io-mcp",
      version: packageJson.version,
    });
  } finally {
    await client.close();
  }
});

test("bulk tools advertise and enforce output capacity before upstream calls", async (t) => {
  const { createMcpServer } = await import("../dist/index.js");
  const { clearToolCacheForTests } = await import("../dist/tools/cache.js");
  clearToolCacheForTests();
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const inputs = body.ips ?? body.uaStrings;
    calls.push(inputs);
    return new Response(JSON.stringify(inputs.map((input) => ({ input }))), {
      headers: { "content-type": "application/json" },
    });
  };
  const server = createMcpServer({ apiKey: "bulk-test-key" });
  const client = new Client({ name: "bulk-capacity-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    globalThis.fetch = originalFetch;
    clearToolCacheForTests();
    await client.close();
    await server.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const { tools } = await client.listTools();

  for (const [name, field] of [
    ["bulk_lookup_ip", "ips"],
    ["bulk_security_check", "ips"],
    ["bulk_parse_user_agent", "uaStrings"],
  ]) {
    await t.test(name, async () => {
      const inputs = Array.from({ length: 250 }, (_, index) =>
        field === "ips" ? `8.8.8.${index + 1}` : `Test-UA-${index}`);
      const before = calls.length;
      const complete = await client.callTool({ name, arguments: { [field]: inputs } });
      assert.equal(complete.isError, undefined);
      assert.deepEqual(JSON.parse(complete.content[0].text), inputs.map((input) => ({ input })));
      assert.equal(calls.length, before + 1);

      for (const length of [251, 1000]) {
        const rejected = await client.callTool({
          name, arguments: { [field]: Array.from({ length }, () => inputs[0]) },
        });
        assert.equal(rejected.isError, true);
        assert.match(rejected.content[0].text, /250/);
        assert.equal(calls.length, before + 1, "oversized input must not reach the paid API");
      }
      const advertised = tools.find((tool) => tool.name === name);
      assert.equal(advertised.inputSchema.properties[field].maxItems, 250);
      assert.match(advertised.description, /250/);
    });
  }
});

test("MCP exposes structured local and schema validation errors before API calls", async (t) => {
  const { createMcpServer } = await import("../dist/index.js");
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("{}"); };
  const server = createMcpServer({ apiKey: "validation-test-key" });
  const client = new Client({ name: "local-error-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await client.close();
    await server.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  for (const [name, args, expected] of [
    ["get_timezone", { lat: "24.86" }, /lat.*long.*provided together/],
    ["get_astronomy", { location: "Karachi, PK", date: "2026-02-30" }, /YYYY-MM-DD/],
    ["convert_timezone", { tz_from: "UTC" }, /destination selector/],
  ]) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, expected);
    assert.equal(result.structuredContent.error.source, "mcp_server");
    assert.equal(result.structuredContent.error.category, "tool_error");
    assert.equal(result.structuredContent.error.status, undefined);
  }
  const schemaRejection = await client.callTool({ name: "get_timezone", arguments: { lat: false } });
  assert.equal(schemaRejection.isError, true);
  assert.match(schemaRejection.content[0].text, /Input validation error/);
  assert.equal(schemaRejection.structuredContent.error.source, "mcp_server");
  assert.equal(schemaRejection.structuredContent.error.category, "validation");
  assert.equal(schemaRejection.structuredContent.error.status, undefined);
  assert.equal(schemaRejection.structuredContent.error.retryable, false);
  await assert.rejects(client.callTool({ name: "unknown_tool", arguments: {} }), /not found/);
  await assert.rejects(client.callTool({ name: "validation-test-key", arguments: {} }), error => {
    assert.doesNotMatch(error.message, /validation-test-key/);
    return /not found/.test(error.message);
  });
  await assert.rejects(client.request({ method: "tools/call", params: { name: "get_my_ip", arguments: {}, task: { ttl: 1000 } } }, (await import("@modelcontextprotocol/sdk/types.js")).CallToolResultSchema), /does not support task creation/);
  assert.equal(calls, 0);
});

test("SDK rejects malformed public-IP responses safely and bounds Unicode failures", async t => {
  const { createMcpServer } = await import("../dist/index.js");
  const originalFetch = globalThis.fetch;
  const previousLimit = process.env.IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS;
  process.env.IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS = "10000";
  const fakeKey = "getip-review-dummy-key";
  let payload = { ip: fakeKey };
  let status = 200;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify(payload), { status });
  };
  const server = createMcpServer({ apiKey: fakeKey });
  const client = new Client({ name: "response-boundary-test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    globalThis.fetch = originalFetch;
    if (previousLimit === undefined) delete process.env.IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS;
    else process.env.IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS = previousLimit;
    await client.close(); await server.close();
  });
  await server.connect(b); await client.connect(a);
  for (const data of [{ ip: fakeKey }, {}]) {
    payload = data;
    const result = await client.callTool({ name: "get_my_ip", arguments: {} });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.source, "mcp_server");
    assert.equal(result.structuredContent.error.category, "upstream_request");
    assert.match(result.structuredContent.error.message, /invalid getip response.*IPv4 or IPv6/);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(fakeKey));
  }
  payload = { message: "界".repeat(4000) }; status = 503;
  const failure = await client.callTool({ name: "get_my_ip", arguments: {} });
  assert.equal(failure.isError, true);
  assert.equal(failure.structuredContent.error.status, 503);
  assert.ok(Buffer.byteLength(JSON.stringify(failure)) <= 10000);
  const validation = await client.callTool({ name: "get_my_ip", arguments: { ['"\\\u0000界😀'.repeat(2000)]: true } });
  assert.equal(validation.isError, true);
  assert.equal(validation.structuredContent.error.category, "validation");
  assert.ok(Buffer.byteLength(JSON.stringify(validation)) <= 10000);
  assert.equal(calls, 3, "local argument failures must not reach the API");
});

test("all tools advertise output schemas and return compatible structured successes", async (t) => {
  const { createMcpServer } = await import("../dist/index.js");
  const { clearToolCacheForTests } = await import("../dist/tools/cache.js");
  clearToolCacheForTests();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const body = options?.body ? JSON.parse(options.body) : undefined;
    const data = { ip: "8.8.8.8", company: {}, network: {}, currency: {}, country_metadata: {}, asn: {}, security: {} };
    return new Response(JSON.stringify(body?.ips ? body.ips.map(ip => ({ ...data, ip }))
      : body?.uaStrings ? body.uaStrings.map(user_agent_string => ({ user_agent_string })) : data));
  };
  const server = createMcpServer({ apiKey: "output-test-key" });
  const client = new Client({ name: "output-test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  t.after(async () => { globalThis.fetch = originalFetch; clearToolCacheForTests(); await client.close(); await server.close(); });
  await server.connect(b);
  await client.connect(a);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 17);
  const manifest = JSON.parse(await readRepoFile("manifest.json"));
  assert.deepEqual(new Set(manifest.tools.map(tool => tool.name)), new Set(tools.map(tool => tool.name)));
  const argumentsByName = {
    lookup_ip: { ip: "8.8.8.8" }, bulk_lookup_ip: { ips: ["8.8.8.8"] },
    check_security: { ip: "8.8.8.8" }, bulk_security_check: { ips: ["8.8.8.8"] },
    lookup_asn: { asn: "AS15169" }, get_abuse_contact: { ip: "8.8.8.8" },
    parse_user_agent: { uaString: "Mozilla/5.0" }, bulk_parse_user_agent: { uaStrings: ["Mozilla/5.0"] },
    get_timezone: { tz: "UTC" }, convert_timezone: { tz_from: "UTC", tz_to: "Asia/Karachi" },
    get_astronomy: { location: "Karachi, PK" },
    get_astronomy_time_series: { location: "Karachi, PK", dateStart: "2026-03-10", dateEnd: "2026-03-12" },
  };
  for (const tool of tools) {
    assert.equal(tool.outputSchema.type, "object", tool.name);
    if (tool.name === "get_cached_result") continue;
    const result = await client.callTool({ name: tool.name, arguments: argumentsByName[tool.name] ?? {} });
    assert.equal(result.isError, undefined, tool.name);
    if (tool.name === "get_my_ip") assert.deepEqual(result.structuredContent, { ip: result.content[0].text });
    else if (tool.name.startsWith("bulk_")) assert.deepEqual(result.structuredContent, { items: JSON.parse(result.content[0].text), errors: [] });
    else assert.deepEqual(result.structuredContent, { data: JSON.parse(result.content[0].text) });
  }
});

test("real MCP clients recover oversized bulk and single results with one API call per lookup", async t => {
  const { createMcpServer } = await import("../dist/index.js");
  const { clearToolCacheForTests } = await import("../dist/tools/cache.js");
  clearToolCacheForTests();
  const previousLimit = process.env.IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS;
  process.env.IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS = "10000";
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const large = { details: '"\\\n😀'.repeat(5000), nested: Array.from({ length: 1000 }, (_, index) => index) };
  globalThis.fetch = async (url, options) => {
    calls++;
    const body = options?.body ? JSON.parse(options.body) : undefined;
    const inputs = body?.ips ?? body?.uaStrings;
    return new Response(JSON.stringify(inputs ? [{ ...large, ip: inputs[0] }, { message: "Invalid input" }] : large));
  };
  const server = createMcpServer({ apiKey: "protocol-pagination-key" });
  const client = new Client({ name: "pagination-test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    globalThis.fetch = originalFetch;
    if (previousLimit === undefined) delete process.env.IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS;
    else process.env.IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS = previousLimit;
    clearToolCacheForTests();
    await client.close(); await server.close();
  });
  await server.connect(b); await client.connect(a);
  for (const [name, args] of [
    ["bulk_lookup_ip", { ips: ["8.8.8.8", "10.0.0.1"] }],
    ["bulk_security_check", { ips: ["8.8.8.8", "10.0.0.1"] }],
    ["bulk_parse_user_agent", { uaStrings: ["Test-UA", "Invalid-UA"] }],
    ["lookup_asn", { asn: "AS15169" }],
  ]) {
    const before = calls;
    let result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, undefined, name);
    const first = result.structuredContent.page;
    assert.ok(first.next_cursor);
    const invalidReplay = await client.callTool({ name: "get_cached_result", arguments: { cursor: first.cursor, force_refresh: true } });
    assert.equal(invalidReplay.isError, true);
    assert.equal(invalidReplay.structuredContent.error.category, "validation");
    const replay = await client.callTool({ name: "get_cached_result", arguments: { cursor: first.cursor } });
    assert.equal(replay.structuredContent.page.json_fragment, first.json_fragment);
    let json = "";
    let pages = 0;
    for (;;) {
      assert.equal(result.isError, undefined);
      assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 10000);
      assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
      const page = result.structuredContent.page;
      assert.equal(page.offset, json.length);
      json += page.json_fragment;
      assert.ok(++pages < 200);
      if (!page.next_cursor) break;
      result = await client.callTool({ name: "get_cached_result", arguments: { cursor: page.next_cursor } });
    }
    const recovered = JSON.parse(json);
    if (name.startsWith("bulk_")) {
      assert.deepEqual(recovered.items[0], { ...large, ip: (args.ips ?? args.uaStrings)[0] });
      assert.deepEqual(recovered.items[1], { message: "Invalid input" });
      assert.equal(recovered.errors[0].input_index, 1);
      assert.equal(recovered.errors[0].input, (args.ips ?? args.uaStrings)[1]);
      assert.equal(recovered.errors[0].status, undefined);
    } else assert.deepEqual(recovered.data, large);
    assert.equal(calls, before + 1, "every page and replay must be free of upstream requests");
  }
});

test("cached-result protocol errors never refetch or cross API-key boundaries", async t => {
  const { createMcpServer } = await import("../dist/index.js");
  const { clearToolCacheForTests } = await import("../dist/tools/cache.js");
  clearToolCacheForTests();
  const previousLimit = process.env.IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS;
  process.env.IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS = "10000";
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ notes: "x".repeat(30000) })); };
  const sessions = [];
  t.after(async () => {
    globalThis.fetch = originalFetch;
    if (previousLimit === undefined) delete process.env.IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS;
    else process.env.IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS = previousLimit;
    clearToolCacheForTests();
    for (const { server, client } of sessions) { await client.close(); await server.close(); }
  });
  for (const apiKey of ["cursor-owner-key", "different-cursor-key"]) {
    const server = createMcpServer({ apiKey });
    const client = new Client({ name: "cursor-isolation-test", version: "1.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b); await client.connect(a);
    sessions.push({ server, client });
  }
  const first = await sessions[0].client.callTool({ name: "lookup_asn", arguments: { asn: "AS15169" } });
  const cursor = first.structuredContent.page.next_cursor;
  for (const [client, value, category] of [
    [sessions[1].client, cursor, "tool_error"],
    [sessions[0].client, "cursor-owner-key", "validation"],
  ]) {
    const result = await client.callTool({ name: "get_cached_result", arguments: { cursor: value } });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.source, "mcp_server");
    assert.equal(result.structuredContent.error.category, category);
    assert.equal(result.structuredContent.error.status, undefined);
    assert.equal(result.structuredContent.error.retryable, false);
    assert.doesNotMatch(JSON.stringify(result), /cursor-owner-key/);
  }
  clearToolCacheForTests();
  const expired = await sessions[0].client.callTool({ name: "get_cached_result", arguments: { cursor } });
  assert.equal(expired.isError, true);
  assert.match(expired.structuredContent.error.message, /unavailable or expired.*No API call/);
  assert.equal(calls, 1);
});

test("mixed bulk failures identify each input without inventing upstream status", async (t) => {
  const { createMcpServer } = await import("../dist/index.js");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([
    { ip: "8.8.8.8", location: {} }, { message: "'10.0.0.1' is a bogon IP address." },
  ]));
  const server = createMcpServer({ apiKey: "mixed-bulk-key" });
  const client = new Client({ name: "mixed-bulk-test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  t.after(async () => { globalThis.fetch = originalFetch; await client.close(); await server.close(); });
  await server.connect(b);
  await client.connect(a);
  for (const name of ["bulk_lookup_ip", "bulk_security_check"]) {
    const result = await client.callTool({ name, arguments: { ips: ["8.8.8.8", "10.0.0.1"], force_refresh: true } });
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.items.length, 2);
    assert.deepEqual(result.structuredContent.items, JSON.parse(result.content[0].text));
    const [error] = result.structuredContent.errors;
    assert.equal(error.input, "10.0.0.1");
    assert.equal(error.input_index, 1);
    assert.equal(error.source, "ipgeolocation_api");
    assert.equal(error.category, "upstream_item");
    assert.equal(error.status, undefined);
    assert.equal(error.retryable, false);
  }
  globalThis.fetch = async () => new Response("[]");
  const mismatch = await client.callTool({ name: "bulk_lookup_ip", arguments: { ips: ["8.8.8.8"], force_refresh: true } });
  assert.equal(mismatch.isError, true);
  assert.match(mismatch.content[0].text, /item count/);
});

test("Dockerfile starts the stdio CLI entrypoint", async () => {
  const dockerfile = await readRepoFile("Dockerfile");

  assert.match(dockerfile, /ENTRYPOINT \["node", "\/app\/dist\/cli\.js"\]/);
  assert.doesNotMatch(
    dockerfile,
    /ENTRYPOINT \["node", "\/app\/dist\/index\.js"\]/
  );
});

test("manifest mcp_config is aligned for stdio startup", async () => {
  const manifest = JSON.parse(await readRepoFile("manifest.json"));
  const expectedConfigMappings = {
    IPGEOLOCATION_API_KEY: "${user_config.api_key}",
    IPGEOLOCATION_REQUEST_TIMEOUT_MS: "${user_config.request_timeout_ms}",
    IPGEOLOCATION_MCP_CACHE_TTL_MS: "${user_config.cache_ttl_ms}",
    IPGEOLOCATION_MCP_CACHE_MAX_ENTRIES:
      "${user_config.cache_max_entries}",
    IPGEOLOCATION_MCP_MAX_BULK_ITEMS: "${user_config.max_bulk_items}",
    IPGEOLOCATION_MCP_MAX_RESULT_ITEMS: "${user_config.max_result_items}",
    IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS:
      "${user_config.max_response_chars}",
    IPGEOLOCATION_MCP_MAX_ERROR_CHARS: "${user_config.max_error_chars}",
  };

  assert.equal(manifest.server.type, "node");
  assert.equal(manifest.server.entry_point, "dist/cli.js");
  assert.equal(manifest.server.mcp_config.command, "node");
  assert.deepEqual(manifest.server.mcp_config.args, [
    "${__dirname}/dist/cli.js",
  ]);
  assert.deepEqual(manifest.server.mcp_config.env, expectedConfigMappings);
  assert.equal(manifest.icon, "icon.png");
  assert.equal(manifest.user_config.api_key.sensitive, true);
  assert.deepEqual(
    Object.keys(manifest.user_config).sort(),
    [
      "api_key",
      "cache_max_entries",
      "cache_ttl_ms",
      "max_bulk_items",
      "max_error_chars",
      "max_response_chars",
      "max_result_items",
      "request_timeout_ms",
    ]
  );
});

test("registry metadata stays aligned across package and server manifest", async () => {
  const packageJson = JSON.parse(await readRepoFile("package.json"));
  const manifest = JSON.parse(await readRepoFile("manifest.json"));
  const serverJson = JSON.parse(await readRepoFile("server.json"));
  const readme = await readRepoFile("README.md");

  assert.equal(
    packageJson.mcpName,
    "io.github.IPGeolocation/ipgeolocation-io-mcp"
  );
  assert.match(
    readme,
    new RegExp(`\\| Version \\| \`${packageJson.version}\` \\|`)
  );
  assert.equal(serverJson.name, packageJson.mcpName);
  assert.equal(serverJson.version, packageJson.version);
  assert.equal(serverJson.packages[0].identifier, packageJson.name);
  assert.equal(serverJson.packages[0].version, packageJson.version);
  assert.equal(serverJson.packages[0].registryType, "npm");
  assert.equal(serverJson.packages[0].transport.type, "stdio");
  assert.equal(packageJson.engines.node, ">=22.0.0");
  assert.equal(
    manifest.compatibility.runtimes.node,
    packageJson.engines.node
  );
});

test("timezone and astronomy tool descriptions are factual and distinguish related endpoints", async () => {
  const timezoneSource = await readRepoFile("src/tools/timezone.ts");
  const astronomySource = await readRepoFile("src/tools/astronomy.ts");

  assert.match(
    timezoneSource,
    /non-English lang is paid-only and returns 401 on free plans\./
  );
  assert.match(
    timezoneSource,
    /provides current local time and metadata for one place, IP, airport, UN\/LOCODE/i
  );
  assert.match(
    timezoneSource,
    /convert_timezone provides source-to-destination conversion/i
  );
  assert.match(
    astronomySource,
    /non-English lang is paid-only and returns 401 on free plans\./
  );
  assert.match(
    astronomySource,
    /server's public egress IP when no selector is provided/i
  );
  assert.match(
    astronomySource,
    /get_astronomy_time_series provides daily sunrise/i
  );
});

test("tool descriptions include response shape and parameter semantics for Glama scoring", async () => {
  const geolocationSource = await readRepoFile("src/tools/geolocation.ts");
  const securitySource = await readRepoFile("src/tools/security.ts");
  const asnSource = await readRepoFile("src/tools/asn.ts");
  const abuseSource = await readRepoFile("src/tools/abuse.ts");
  const userAgentSource = await readRepoFile("src/tools/useragent.ts");

  assert.match(geolocationSource, /Returns root IP\/domain data/);
  assert.match(geolocationSource, /fields\/excludes accept comma-separated dot paths/);
  assert.match(geolocationSource, /not geolocation data/);
  assert.match(geolocationSource, /Private, bogon, and malformed/);
  assert.match(securitySource, /Returns \{ ip, security \}/);
  assert.match(securitySource, /security\.\* dot paths/);
  assert.match(asnSource, /Returns \{ asn \}/);
  assert.match(asnSource, /with asn taking priority/);
  assert.match(abuseSource, /Returns \{ ip, abuse \}/);
  assert.match(userAgentSource, /Paid only for POST payload parsing/);
  assert.match(userAgentSource, /uaString must be the exact non-empty user-agent string/);
});

test("README keeps parse_user_agent as paid-only without mentioning GET in that section", async () => {
  const readme = await readRepoFile("README.md");
  const match = readme.match(
    /### parse_user_agent[\s\S]*?(?=\n### |\n## |\n# |$)/
  );

  assert.ok(match, "parse_user_agent section must exist in README");
  const section = match[0];
  assert.match(section, /Paid\./);
  assert.match(section, /1 credit/);
  assert.match(section, /The user-agent string to parse/);
  assert.doesNotMatch(section, /GET `\/v3\/user-agent`/);
});
