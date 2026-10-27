import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { isIP } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const image = process.env.MCP_DOCKER_IMAGE || "ipgeolocation-io-mcp:security-test";

test("Docker runtime uses patched Node and preserves the stdio tool contract", async () => {
  const runtime = JSON.parse(execFileSync("docker", [
    "run", "--rm", "--network", "none", "--entrypoint", "node", image,
    "-p", "JSON.stringify({ version: process.version, uid: process.getuid() })",
  ], { encoding: "utf8", timeout: 30000 }));
  const [major, minor, patch] = runtime.version.slice(1).split(".").map(Number);
  assert.ok(major === 24 && (minor > 22 || (minor === 22 && patch >= 1)), runtime.version);
  assert.equal(runtime.uid, 1000);

  const transport = new StdioClientTransport({
    command: "docker",
    args: ["run", "--rm", "--interactive", "--network", "none", "--read-only",
      "--env", "IPGEOLOCATION_API_KEY=container-test-key", image],
    stderr: "pipe",
  });
  const client = new Client({ name: "container-smoke-test", version: "1.0.0" });
  try {
    await client.connect(transport, { timeout: 10000 });
    assert.equal(client.getServerVersion().name, "ipgeolocation-io-mcp");
    const { tools } = await client.listTools();
    assert.equal(tools.length, 17);
    assert.ok(tools.some((tool) => tool.name === "get_cached_result"));
    const result = await client.callTool({ name: "lookup_ip", arguments: { ip: 42 } });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.source, "mcp_server");
    assert.equal(result.structuredContent.error.category, "validation");
    assert.match(result.structuredContent.error.message, /Input validation error/);
  } finally {
    await client.close();
  }
});

test("Docker runtime preserves real HTTPS lookups and authentication errors", { timeout: 60000 }, async () => {
  const transport = new StdioClientTransport({
    command: "docker",
    args: ["run", "--rm", "--interactive", "--read-only",
      "--env", "IPGEOLOCATION_API_KEY=container-invalid-key", image],
    stderr: "pipe",
  });
  const client = new Client({ name: "container-https-test", version: "1.0.0" });
  try {
    await client.connect(transport, { timeout: 10000 });
    const publicIp = await client.callTool({ name: "get_my_ip", arguments: {} }, undefined, { timeout: 20000 });
    assert.notEqual(publicIp.isError, true, JSON.stringify(publicIp.structuredContent?.error));
    assert.ok(isIP(publicIp.structuredContent.ip) > 0);

    const unauthorized = await client.callTool({
      name: "lookup_ip", arguments: { ip: "8.8.8.8" },
    }, undefined, { timeout: 20000 });
    assert.equal(unauthorized.isError, true);
    assert.equal(unauthorized.structuredContent.error.source, "ipgeolocation_api");
    assert.equal(unauthorized.structuredContent.error.status, 401);
  } finally {
    await client.close();
  }
});
