import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Portable when copied to tests/ beside fixtures/readiness-fetch.fixture.mjs.
const runtimeRoot = process.env.SERVER_RUNTIME_ROOT || fileURLToPath(new URL('../dist/', import.meta.url));
const fixture = new URL('./fixtures/readiness-fetch.fixture.mjs', import.meta.url).href;
const argumentLimit = 65536;
const syntheticKey = 'stdio-boundary-synthetic-key';

function cli(t) {
  const child = spawn(process.execPath, ['--import', fixture, join(runtimeRoot, 'cli.js')], {
    cwd: runtimeRoot,
    env: { ...process.env, IPGEOLOCATION_API_KEY: syntheticKey, IPGEOLOCATION_MCP_MAX_ARGUMENT_BYTES: String(argumentLimit) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '', exited;
  const replies = [];
  const waiting = new Set();
  const changed = () => { for (const check of [...waiting]) check(); };
  child.stdin.on('error', () => {});
  child.stdout.on('data', bytes => {
    stdout += bytes;
    let index;
    while ((index = stdout.indexOf('\n')) !== -1) {
      const line = stdout.slice(0, index); stdout = stdout.slice(index + 1);
      if (line) replies.push(JSON.parse(line));
    }
    changed();
  });
  child.stderr.on('data', bytes => { stderr += bytes; });
  const closed = new Promise((resolve, reject) => {
    child.once('close', (code, signal) => { exited = { code, signal }; changed(); resolve(exited); });
    child.once('error', reject);
  });
  t.after(() => { if (!exited) child.kill('SIGKILL'); });
  const reply = id => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { waiting.delete(check); reject(new Error(`Timed out waiting for JSON-RPC reply ${id}`)); }, 5000);
    const check = () => {
      const value = replies.find(item => item.id === id);
      if (!value && !exited) return;
      clearTimeout(timeout); waiting.delete(check);
      if (value) resolve(value);
      else reject(new Error(`CLI closed before JSON-RPC reply ${id}: ${JSON.stringify(exited)}`));
    };
    waiting.add(check); check();
  });
  return { child, closed, reply, stderr: () => stderr };
}

test('real CLI accepts concatenated near-limit frames after a boundary-shifting valid prefix', { timeout: 10000 }, async t => {
  const { child, closed, reply } = cli(t);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {
    protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'stdio-boundary-regression', version: '1.0.0' },
  } }) + '\n');
  assert.equal((await reply(0)).error, undefined);
  const argumentsFor = suffix => ({ uaString: 'x'.repeat(argumentLimit - Buffer.byteLength(JSON.stringify({ uaString: '' })) - 33) + suffix });
  const frames = [1, 2].map(id => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: {
    name: 'parse_user_agent', arguments: argumentsFor(String(id)),
  } }) + '\n');
  assert.equal(Buffer.byteLength(JSON.stringify(argumentsFor('1'))), argumentLimit - 32);
  const prefix = { jsonrpc: '2.0', method: 'notifications/initialized', params: { _meta: { padding: '' } } };
  // With 64-KiB pipe reads, the second chunk ends one byte before frame one's newline.
  const prefixBytes = 2 * 65536 - Buffer.byteLength(frames[0]) + 1;
  prefix.params._meta.padding = 'x'.repeat(prefixBytes - Buffer.byteLength(JSON.stringify(prefix) + '\n'));
  child.stdin.write(Buffer.from(JSON.stringify(prefix) + '\n' + frames.join('')));
  const results = await Promise.all([reply(1), reply(2)]);
  for (const result of results) {
    assert.equal(result.error, undefined);
    assert.equal(result.result.isError, undefined);
    assert.equal(result.result.structuredContent.data.user_agent_string, 'synthetic-framing-result');
  }
  child.stdin.end();
  assert.deepEqual(await closed, { code: 0, signal: null });
});

test('real CLI still closes an oversized unfinished frame while the writer remains open', { timeout: 10000 }, async t => {
  const { child, closed, stderr } = cli(t);
  child.stdin.write(Buffer.alloc(6 * argumentLimit + 128 * 1024 + 1, 120));
  const exit = await closed;
  assert.equal(exit.signal, null);
  assert.ok(!stderr().includes(syntheticKey));
  assert.match(stderr(), /stdio input was rejected/i);
});

test('real CLI clean EOF exits normally', { timeout: 10000 }, async t => {
  const { child, closed } = cli(t);
  child.stdin.end();
  assert.deepEqual(await closed, { code: 0, signal: null });
});
