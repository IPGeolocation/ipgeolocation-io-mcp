import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

test("32 concurrent near-limit provider responses fit the hosted memory budget", { timeout: 90000 }, async t => {
  const runtime = process.env.QA_RUNTIME_ROOT || fileURLToPath(new URL("../dist", import.meta.url));
  const sdk = path.resolve(runtime, "../node_modules/@modelcontextprotocol/sdk/dist/esm/client");
  const { Client } = await import(pathToFileURL(path.join(sdk, "index.js")));
  const { StreamableHTTPClientTransport } = await import(pathToFileURL(path.join(sdk, "streamableHttp.js")));
  const wire = JSON.stringify({ ip: "8.8.8.8", rows: Array.from({ length: 90000 }, (_, i) => ({
    route: "203.0.113." + (i % 255), value: "x".repeat(52),
  })) });
  assert.ok(Buffer.byteLength(wire) < 8 * 1024 * 1024);
  const upstream = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(wire);
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  t.after(async () => { upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); });

  const reservation = http.createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const temp = await mkdtemp(path.join(tmpdir(), "ipgeo-hosted-load-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const entry = path.join(temp, "child.mjs");
  await writeFile(entry, `
    const original = globalThis.fetch;
    globalThis.fetch = (input, options) => {
      const url = new URL(input);
      if (url.origin !== 'https://api.ipgeolocation.io') throw Error('Unexpected provider');
      return original('http://127.0.0.1:${upstream.address().port}' + url.pathname + url.search, options);
    };
    const sample = () => console.error(JSON.stringify({ rss: process.memoryUsage().rss, maxRss: process.resourceUsage().maxRSS * 1024 }));
    setInterval(sample, 100).unref();
    process.on('exit', sample);
    await import(${JSON.stringify(pathToFileURL(path.join(runtime, "http-cli.js")).href)});
  `);
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith("IPGEOLOCATION_")) delete env[name];
  Object.assign(env, {
    IPGEOLOCATION_MCP_HTTP_PORT: String(port),
    IPGEOLOCATION_MCP_PUBLIC_URL: "http://127.0.0.1:" + port + "/mcp",
    // This checks memory; shared-runner CPU speed must not trigger the API deadline.
    IPGEOLOCATION_REQUEST_TIMEOUT_MS: "60000",
  });
  const child = spawn(process.execPath, ["--max-old-space-size=512", entry], {
    cwd: temp, env, stdio: ["ignore", "ignore", "pipe"],
  });
  const exited = once(child, "exit");
  let exitResult;
  exited.then(value => { exitResult = value; });
  t.after(async () => { if (!exitResult) { child.kill("SIGKILL"); await exited; } });
  let lines = "";
  let ready = false;
  let maxRss = 0;
  child.stderr.on("data", data => {
    lines += data;
    let end;
    while ((end = lines.indexOf("\n")) >= 0) {
      const line = lines.slice(0, end);
      lines = lines.slice(end + 1);
      try {
        const event = JSON.parse(line);
        if (event.event === "http_listening") ready = true;
        maxRss = Math.max(maxRss, event.rss || 0, event.maxRss || 0);
      } catch {}
    }
  });
  for (let i = 0; !ready && !exitResult && i < 600; i++) await delay(10);
  assert.ok(ready, "Load-test child must start");
  const clients = [];
  t.after(async () => { for (const client of clients) await client.close().catch(() => {}); });
  for (let i = 0; i < 1; i++) {
    const client = new Client({ name: "bounded-load-test", version: "1" });
    clients.push(client);
    await client.connect(new StreamableHTTPClientTransport(new URL(env.IPGEOLOCATION_MCP_PUBLIC_URL), {
      requestInit: { redirect: "error", headers: {
        "X-IPGeolocation-API-Key": "synthetic-load-" + i, "X-Real-IP": "203.0.113." + (i + 1),
      } },
    }));
  }
  const results = await Promise.race([
    Promise.all(Array.from({ length: 32 }, (_, i) => clients[0].callTool({
      name: "lookup_ip", arguments: { ip: "8.8.0." + (i + 1) },
    }, undefined, { timeout: 75000 }))),
    delay(80000, undefined, { ref: false }).then(() => { throw new Error("Load-test deadline"); }),
  ]);
  for (const result of results) assert.ok(!result.isError, "All concurrent tool calls must succeed: " + JSON.stringify(result.structuredContent?.error));
  for (const client of clients) await client.close();
  child.kill("SIGTERM");
  await exited;
  assert.deepEqual(exitResult, [0, null]);
  assert.ok(maxRss > 0 && maxRss < 768 * 1024 * 1024, "Server must retain headroom within its 1 GiB container limit");
  t.diagnostic(JSON.stringify({ attempts: results.length, payloadBytes: Buffer.byteLength(wire), serverPeakRssMiB: Math.round(maxRss / 1024 / 1024) }));
});
