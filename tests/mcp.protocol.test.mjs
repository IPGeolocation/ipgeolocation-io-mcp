import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

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

  assert.equal(manifest.server.type, "node");
  assert.equal(manifest.server.entry_point, "dist/cli.js");
  assert.equal(manifest.server.mcp_config.command, "node");
  assert.deepEqual(manifest.server.mcp_config.args, [
    "${__dirname}/dist/cli.js",
  ]);
  assert.equal(
    manifest.server.mcp_config.env.IPGEOLOCATION_API_KEY,
    "${user_config.api_key}"
  );
});

test("registry metadata stays aligned across package and server manifest", async () => {
  const packageJson = JSON.parse(await readRepoFile("package.json"));
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
});

test("timezone and astronomy tool docs include Glama-facing selection guidance", async () => {
  const timezoneSource = await readRepoFile("src/tools/timezone.ts");
  const astronomySource = await readRepoFile("src/tools/astronomy.ts");

  assert.match(
    timezoneSource,
    /non-English lang is paid-only and returns 401 on free plans\./
  );
  assert.match(
    timezoneSource,
    /Use when the user asks for one place, IP, airport, UN\/LOCODE/i
  );
  assert.match(timezoneSource, /use convert_timezone for source-to-destination conversion/i);
  assert.match(
    astronomySource,
    /non-English lang is paid-only and returns 401 on free plans\./
  );
  assert.match(
    astronomySource,
    /caller IP when no selector is provided/i
  );
  assert.match(astronomySource, /use get_astronomy_time_series for daily sunrise/i);
});

test("tool descriptions include response shape and parameter semantics for Glama scoring", async () => {
  const geolocationSource = await readRepoFile("src/tools/geolocation.ts");
  const securitySource = await readRepoFile("src/tools/security.ts");
  const asnSource = await readRepoFile("src/tools/asn.ts");
  const abuseSource = await readRepoFile("src/tools/abuse.ts");
  const userAgentSource = await readRepoFile("src/tools/useragent.ts");

  assert.match(geolocationSource, /Returns root IP\/domain data/);
  assert.match(geolocationSource, /fields\/excludes use comma-separated dot paths/);
  assert.match(geolocationSource, /not geolocation data/);
  assert.match(geolocationSource, /Private, bogon, and malformed/);
  assert.match(securitySource, /Returns \{ ip, security \}/);
  assert.match(securitySource, /security\.\* dot paths/);
  assert.match(asnSource, /Returns \{ asn \}/);
  assert.match(asnSource, /asn takes priority over ip/);
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
