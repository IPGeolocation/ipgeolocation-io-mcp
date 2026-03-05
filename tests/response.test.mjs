import test from "node:test";
import assert from "node:assert/strict";

const RESPONSE_ENV_KEYS = [
  "IPGEOLOCATION_MCP_MAX_BULK_ITEMS",
  "IPGEOLOCATION_MCP_MAX_RESULT_ITEMS",
  "IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS",
  "IPGEOLOCATION_MCP_MAX_ERROR_CHARS",
];

function responseModuleUrl() {
  const url = new URL("../dist/tools/response.js", import.meta.url);
  url.searchParams.set("t", `${Date.now()}-${Math.random()}`);
  return url.href;
}

function clearResponseEnv() {
  for (const key of RESPONSE_ENV_KEYS) {
    delete process.env[key];
  }
}

test("formatToolResult truncates large arrays by default", async (t) => {
  clearResponseEnv();
  t.after(clearResponseEnv);

  const { formatToolResult } = await import(responseModuleUrl());
  const sample = Array.from({ length: 300 }, (_, index) => ({ index }));
  const formatted = formatToolResult(sample);
  const parsed = JSON.parse(formatted);

  assert.equal(parsed.truncated, true);
  assert.equal(parsed.total_items, 300);
  assert.equal(parsed.shown_items, 250);
  assert.equal(parsed.items.length, 250);
});

test("formatToolResult respects IPGEOLOCATION_MCP_MAX_RESULT_ITEMS", async (t) => {
  clearResponseEnv();
  process.env.IPGEOLOCATION_MCP_MAX_RESULT_ITEMS = "10";
  t.after(clearResponseEnv);

  const { formatToolResult } = await import(responseModuleUrl());
  const sample = Array.from({ length: 11 }, (_, index) => ({ index }));
  const parsed = JSON.parse(formatToolResult(sample));

  assert.equal(parsed.truncated, true);
  assert.equal(parsed.shown_items, 10);
  assert.equal(parsed.items.length, 10);
});

test("errorToolResponse truncates long error messages", async (t) => {
  clearResponseEnv();
  t.after(clearResponseEnv);

  const { errorToolResponse } = await import(responseModuleUrl());
  const response = errorToolResponse(new Error("x".repeat(5000)));
  const text = response.content[0].text;

  assert.equal(response.isError, true);
  assert.ok(text.startsWith("Error: "));
  assert.ok(text.length < 4200);
  assert.match(text, /error truncated at 4,000 characters/);
});

test("errorToolResponse uses configured max error chars", async (t) => {
  clearResponseEnv();
  process.env.IPGEOLOCATION_MCP_MAX_ERROR_CHARS = "250";
  t.after(clearResponseEnv);

  const { errorToolResponse } = await import(responseModuleUrl());
  const response = errorToolResponse(new Error("y".repeat(1000)));
  const text = response.content[0].text;

  assert.ok(text.length < 350);
  assert.match(text, /error truncated at 250 characters/);
});
