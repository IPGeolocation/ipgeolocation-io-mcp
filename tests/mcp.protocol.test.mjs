import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

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
  assert.match(indexSource, /If one IP needs two or more IP domains, make one lookup_ip call first/);
  assert.match(indexSource, /Use narrow IP tools .* only for single-domain requests\./);
  assert.match(indexSource, /If the first response is a superset of what is needed, answer from that response and do not call another tool for formatting\./);
  assert.match(indexSource, /For ASN queries, make at most one lookup_asn call per target and include set\./);
  assert.match(indexSource, /Never call the same tool twice for the same target in one answer unless the prior call failed or required data is truly missing\./);
  assert.match(indexSource, /Use fields to request only required paths/);
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

  assert.equal(validConfig.success, true);
  assert.equal(invalidConfig.success, false);
  assert.ok(entrypoint.default({ config: { apiKey: "test-key" } }));
});

test("manifest mcp_config is aligned for stdio startup", async () => {
  const manifest = JSON.parse(await readRepoFile("manifest.json"));

  assert.equal(manifest.server.type, "node");
  assert.equal(manifest.server.entry_point, "dist/cli.js");
  assert.equal(manifest.server.mcp_config.command, "node");
  assert.deepEqual(manifest.server.mcp_config.args, ["${__dirname}/dist/cli.js"]);
  assert.equal(
    manifest.server.mcp_config.env.IPGEOLOCATION_API_KEY,
    "${user_config.api_key}"
  );
});

test("registry metadata stays aligned across package and server manifest", async () => {
  const packageJson = JSON.parse(await readRepoFile("package.json"));
  const serverJson = JSON.parse(await readRepoFile("server.json"));

  assert.equal(
    packageJson.mcpName,
    "io.github.IPGeolocation/ipgeolocation-io-mcp"
  );
  assert.equal(serverJson.name, packageJson.mcpName);
  assert.equal(serverJson.version, packageJson.version);
  assert.equal(serverJson.packages[0].identifier, packageJson.name);
  assert.equal(serverJson.packages[0].version, packageJson.version);
  assert.equal(serverJson.packages[0].registryType, "npm");
  assert.equal(serverJson.packages[0].transport.type, "stdio");
});

test("timezone and astronomy tool docs reflect free non-English lang 401 behavior", async () => {
  const timezoneSource = await readRepoFile("src/tools/timezone.ts");
  const astronomySource = await readRepoFile("src/tools/astronomy.ts");

  assert.match(
    timezoneSource,
    /Free plan returns 401 for non-English language values\./
  );
  assert.match(
    astronomySource,
    /Free plan returns 401 for non-English language values\./
  );
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
