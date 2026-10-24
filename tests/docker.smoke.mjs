import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const image = process.env.MCP_DOCKER_IMAGE || "ipgeolocation-io-mcp:security-test";

test("Docker runtime uses patched Node and preserves the stdio tool contract", async () => {
  const version = execFileSync("docker", [
    "run", "--rm", "--network", "none", "--entrypoint", "node", image, "--version",
  ], { encoding: "utf8", timeout: 30000 }).trim();
  const [major, minor, patch] = version.slice(1).split(".").map(Number);
  assert.ok(major === 24 && (minor > 22 || (minor === 22 && patch >= 1)), version);

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
