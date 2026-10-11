import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [mode, suppliedCommand, ...suppliedArgs] = process.argv.slice(2);
assert.ok(mode === "free" || mode === "paid", "Usage: node tests/pagination.stdio.mjs <free|paid> [server-command ...args]");
const key = process.env[mode === "free" ? "IPGEOLOCATION_FREE_KEY" : "IPGEOLOCATION_PAID_KEY"];
assert.ok(key, `IPGEOLOCATION_${mode.toUpperCase()}_KEY is required`);
const command = suppliedCommand ?? process.execPath;
const args = suppliedCommand ? suppliedArgs : [fileURLToPath(new URL("../dist/cli.js", import.meta.url))];
const sha256 = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Observe only billing/count/hash metadata; no credentials or response contents are logged.
const trace = `import { createHash } from 'node:crypto';
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async (...args) => {
  const response = await fetchOriginal(...args);
  const data = await response.clone().json();
  console.error('PAGINATION_QA ' + JSON.stringify({status: response.status, credits: response.headers.get('x-credits-charged'), hash: createHash('sha256').update(JSON.stringify(data)).digest('hex')}));
  return response;
};`;
const env = {
  ...process.env,
  IPGEOLOCATION_API_KEY: key,
  IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS: "10000",
  IPGEOLOCATION_MCP_CACHE_TTL_MS: "1000",
  NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(trace)}`,
};

async function session() {
  const client = new Client({ name: "pagination-stdio-qa", version: "1.0.0" });
  const transport = new StdioClientTransport({ command, args, env, stderr: "pipe" });
  let stderr = "";
  transport.stderr.on("data", chunk => { stderr += chunk.toString(); });
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 17);
  return { client, stderr: () => stderr };
}

const firstSession = await session();
let cursor;
try {
  const ips = ["8.8.8.8", "1.1.1.1", "9.9.9.9", "8.8.4.4", "1.0.0.1", "208.67.222.222"];
  let response = await firstSession.client.callTool({ name: "bulk_lookup_ip", arguments: { ips } });
  assert.equal(response.isError, undefined);
  const first = response.structuredContent.page;
  assert.ok(first?.next_cursor, "The reduced response budget must produce multiple pages");
  cursor = first.cursor;
  const replay = await firstSession.client.callTool({ name: "get_cached_result", arguments: { cursor } });
  assert.equal(replay.structuredContent.page.json_fragment, first.json_fragment);
  let json = "";
  let pages = 0;
  for (;;) {
    assert.equal(response.isError, undefined);
    assert.ok(Buffer.byteLength(JSON.stringify(response)) <= 10000);
    assert.ok(!JSON.stringify(response).includes(key));
    assert.deepEqual(JSON.parse(response.content[0].text), response.structuredContent);
    const page = response.structuredContent.page;
    assert.equal(page.offset, json.length);
    json += page.json_fragment;
    assert.ok(++pages < 100);
    if (!page.next_cursor) break;
    response = await firstSession.client.callTool({ name: "get_cached_result", arguments: { cursor: page.next_cursor } });
  }
  const complete = JSON.parse(json);
  assert.deepEqual(complete.items.map(item => item.ip), ips);
  assert.deepEqual(complete.errors, []);
  const records = firstSession.stderr().split("\n").filter(line => line.startsWith("PAGINATION_QA ")).map(line => JSON.parse(line.slice("PAGINATION_QA ".length)));
  assert.equal(records.length, 1, "Every page and replay must avoid another API call");
  assert.equal(records[0].status, 200);
  assert.equal(Number(records[0].credits), ips.length);
  assert.equal(sha256(complete.items), records[0].hash, "Recovered records must exactly match the full upstream JSON");
  await new Promise(resolve => setTimeout(resolve, 1150));
  const expired = await firstSession.client.callTool({ name: "get_cached_result", arguments: { cursor } });
  assert.equal(expired.isError, true);
  assert.equal(expired.structuredContent.error.retryable, false);
  assert.match(expired.structuredContent.error.message, /unavailable or expired.*No API call/);
  assert.equal(firstSession.stderr().split("PAGINATION_QA ").length - 1, 1);
  assert.ok(!firstSession.stderr().includes(key));
  console.log(`PASS ${mode} live pagination: ${pages} complete bounded pages, exact upstream JSON hash, 1 API call, ${records[0].credits} initial credits, 0 additional page/replay/expiry credits`);
} finally { await firstSession.client.close(); }

const restarted = await session();
try {
  const result = await restarted.client.callTool({ name: "get_cached_result", arguments: { cursor } });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error.source, "mcp_server");
  assert.equal(result.structuredContent.error.retryable, false);
  assert.ok(!restarted.stderr().includes("PAGINATION_QA "));
  assert.ok(!JSON.stringify(result).includes(key));
  console.log("PASS process restart: unavailable cursor fails locally with 0 API calls");
} finally { await restarted.client.close(); }
