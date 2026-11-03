import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const runtimeRoot = resolve(process.env.SERVER_RUNTIME_ROOT ?? fileURLToPath(new URL('../dist', import.meta.url)));
const load = name => import(pathToFileURL(join(runtimeRoot, name)).href);
const [api, config, cache, serverModule, errors] = await Promise.all([
  load('client.js'), load('config.js'), load('tools/cache.js'), load('index.js'), load('errors.js'),
]);
const nativeFetch = globalThis.fetch;
const syntheticKey = 'transport-hardening-synthetic-key';
const argumentLimit = 65536;
const wireLimit = 6 * argumentLimit + 128 * 1024;
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));

function setup(t) {
  const names = ['IPGEOLOCATION_REQUEST_TIMEOUT_MS', 'IPGEOLOCATION_UPSTREAM_MAX_RESPONSE_BYTES'];
  const previous = names.map(name => process.env[name]);
  process.env.IPGEOLOCATION_REQUEST_TIMEOUT_MS = '1000';
  process.env.IPGEOLOCATION_UPSTREAM_MAX_RESPONSE_BYTES = String(1024 * 1024);
  const fetch = globalThis.fetch;
  cache.clearToolCacheForTests();
  t.after(() => {
    globalThis.fetch = fetch;
    cache.clearToolCacheForTests();
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  });
}

async function session(t, apiKey = syntheticKey) {
  const server = serverModule.createMcpServer({ apiKey });
  const client = new Client({ name: 'transport-hardening', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a); await client.listTools();
  t.after(async () => { await client.close(); await server.close(); });
  return (name, args = {}, options) => client.callTool({ name, arguments: args }, undefined, options);
}

for (const [name, args] of [
  ['check_security', { ip: '8.8.8.8' }], ['bulk_security_check', { ips: ['8.8.8.8'] }],
]) {
  for (const mode of ['stall', 'cut']) {
    test(`${name} does not mark an interrupted successful ${mode} response retryable`, async t => {
      setup(t); let requests = 0;
      const upstream = createServer((request, response) => {
        requests++; request.resume(); response.writeHead(200, { 'content-type': 'application/json' });
        response.write(name.startsWith('bulk_') ? '[' : '{');
        if (mode === 'cut') {
          const timer = setTimeout(() => response.destroy(), 25);
          response.on('close', () => clearTimeout(timer));
        }
      });
      await new Promise(resolveListen => upstream.listen(0, '127.0.0.1', resolveListen));
      t.after(async () => { upstream.closeAllConnections(); await new Promise(resolveClose => upstream.close(resolveClose)); });
      globalThis.fetch = (_url, options) => nativeFetch(`http://127.0.0.1:${upstream.address().port}`, options);
      const call = await session(t), result = await call(name, args), error = result.structuredContent.error;
      assert.equal(result.isError, true);
      assert.equal(error.source, 'mcp_server');
      assert.equal(error.category, mode === 'stall' ? 'timeout' : 'upstream_request');
      assert.equal(error.status, mode === 'stall' ? 504 : 502);
      assert.equal(error.retryable, false);
      assert.match(error.message, /API returned a success status/);
      assert.match(error.message, /credits again/);
      assert.match(error.guidance, /Do not retry automatically.*approval/);
      assert.equal(requests, 1);
    });
  }
}

test('a deadline before HTTP headers retains retry guidance without claiming success', async t => {
  setup(t); let requests = 0;
  const upstream = createServer(request => { requests++; request.resume(); });
  await new Promise(resolveListen => upstream.listen(0, '127.0.0.1', resolveListen));
  t.after(async () => { upstream.closeAllConnections(); await new Promise(resolveClose => upstream.close(resolveClose)); });
  globalThis.fetch = (_url, options) => nativeFetch(`http://127.0.0.1:${upstream.address().port}`, options);
  const call = await session(t), result = await call('check_security', { ip: '8.8.8.8' });
  assert.equal(result.structuredContent.error.category, 'timeout');
  assert.equal(result.structuredContent.error.retryable, true);
  assert.match(result.structuredContent.error.guidance, /only with approval/);
  assert.doesNotMatch(result.structuredContent.error.message, /success status/);
  assert.equal(requests, 1);
});

test('invalid credential characters fail locally without exposing character details or blocking keyless tools', async t => {
  setup(t); let requests = 0, fetchCalls = 0;
  const upstream = createServer((request, response) => {
    requests++; request.resume();
    assert.equal(request.headers['x-ipgeolocation-api-key'], undefined);
    response.setHeader('content-type', 'application/json'); response.end('{"ip":"198.51.100.7"}');
  });
  await new Promise(resolveListen => upstream.listen(0, '127.0.0.1', resolveListen));
  t.after(async () => { upstream.closeAllConnections(); await new Promise(resolveClose => upstream.close(resolveClose)); });
  globalThis.fetch = (_url, options) => { fetchCalls++; return nativeFetch(`http://127.0.0.1:${upstream.address().port}`, options); };
  const redaction = await load('redaction.js');
  const keys = ['synthetic\u043akey', 'synthetic\u007fkey', 'synthetic\rkey', 'synthetic\nkey', 'synthetic\u0000key',
    'synthetic\tkey', 'synthetic\u200bkey', 'synthetic\ufeffkey', 'synthetic\u00e9key', 'synthetic key', 'synthetic\ud800key'];
  for (const key of keys) {
    const call = await session(t, key), result = await call('check_security', { ip: '8.8.8.8' });
    const error = result.structuredContent.error;
    assert.equal(error.source, 'mcp_server');
    assert.equal(error.category, 'configuration');
    assert.equal(error.status, 400);
    assert.equal(error.retryable, false);
    assert.equal(error.message, 'API key must contain only printable ASCII characters without spaces. Update IPGEOLOCATION_API_KEY. No API request was sent.');
    assert.doesNotMatch(JSON.stringify(result), /character at index|value of \d|ByteString|fetch failed/);
    assert.equal(config.withRuntimeConfig({ apiKey: key }, () => redaction.redactKnownSecrets(key)), '[REDACTED_API_KEY]');
  }
  assert.equal(fetchCalls, 0);
  assert.equal(requests, 0);
  const call = await session(t, keys[0]), result = await call('get_my_ip');
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.ip, '198.51.100.7');
  assert.equal(requests, 1);
});

test('valid printable API keys retain their exact normalized header value', async t => {
  setup(t); let requests = 0, expected;
  const upstream = createServer((request, response) => {
    requests++; request.resume();
    assert.equal(request.headers['x-ipgeolocation-api-key'], expected);
    response.setHeader('content-type', 'application/json'); response.end('{"ip":"8.8.8.8","security":{}}');
  });
  await new Promise(resolveListen => upstream.listen(0, '127.0.0.1', resolveListen));
  t.after(async () => { upstream.closeAllConnections(); await new Promise(resolveClose => upstream.close(resolveClose)); });
  globalThis.fetch = (_url, options) => nativeFetch(`http://127.0.0.1:${upstream.address().port}`, options);
  for (const key of ['  synthetic-ASCII-key-42  ', '0123456789abcdef0123456789abcdef', 'synthetic/key+with=symbols']) {
    expected = key.trim();
    assert.deepEqual(await config.withRuntimeConfig({ apiKey: key }, () => api.getSecurity({ ip: '8.8.8.8' })), { ip: '8.8.8.8', security: {} });
  }
  assert.equal(requests, 3);
});

for (const status of [401, 429]) {
  for (const [name, args] of [
    ['lookup_ip', { ip: '8.8.8.8' }], ['bulk_lookup_ip', { ips: ['8.8.8.8'] }], ['get_my_ip', {}],
  ]) {
    test(`${name} preserves received HTTP ${status} when its body exceeds the deadline`, async t => {
      setup(t);
      let requests = 0;
      const upstream = createServer((request, response) => {
        requests++; request.resume();
        response.writeHead(status, { 'content-type': 'application/json' });
        response.write(`{"message":"unfinished ${syntheticKey}`);
      });
      await new Promise(resolveListen => upstream.listen(0, '127.0.0.1', resolveListen));
      t.after(async () => { upstream.closeAllConnections(); await new Promise(resolveClose => upstream.close(resolveClose)); });
      globalThis.fetch = (url, options) => {
        assert.equal(new URL(url).origin, 'https://api.ipgeolocation.io');
        return nativeFetch(`http://127.0.0.1:${upstream.address().port}/slow-error`, options);
      };
      const call = await session(t), started = performance.now();
      const result = await call(name, args);
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent.error.source, 'ipgeolocation_api');
      assert.equal(result.structuredContent.error.status, status);
      assert.equal(result.structuredContent.error.category, status === 401 ? 'authentication' : 'rate_limit');
      assert.equal(result.structuredContent.error.retryable, false);
      assert.match(result.structuredContent.error.message, /error body was unavailable.*HTTP status is preserved/);
      assert.doesNotMatch(JSON.stringify(result), new RegExp(syntheticKey));
      assert.equal(requests, 1);
      assert.ok(performance.now() - started < 2500, 'the body-read deadline must remain active');
    });
  }
}

test('explicit cancellation wins even when the deadline signal aborted first', async t => {
  setup(t);
  const caller = new AbortController();
  let requests = 0;
  globalThis.fetch = async (_url, options) => {
    requests++;
    return new Response(new ReadableStream({
      start(stream) {
        options.signal.addEventListener('abort', () => {
          caller.abort(new Error('Synthetic explicit cancellation'));
          stream.error(options.signal.reason);
        }, { once: true });
      },
    }), { status: 401 });
  };
  await assert.rejects(config.withRuntimeConfig({ apiKey: syntheticKey }, () => config.withRequestSignal(caller.signal,
    () => api.getIpGeolocation({ ip: '8.8.8.8' }))), error => error instanceof errors.RequestCancelledError);
  assert.equal(requests, 1);
});

for (const status of [200, 429]) test(`explicit cancellation closes a native slow HTTP ${status} body without retrying`, async t => {
  setup(t);
  const started = Promise.withResolvers();
  let requests = 0;
  const upstream = createServer((request, response) => {
    requests++; request.resume(); response.writeHead(status); response.flushHeaders(); started.resolve();
  });
  await new Promise(resolveListen => upstream.listen(0, '127.0.0.1', resolveListen));
  t.after(async () => { upstream.closeAllConnections(); await new Promise(resolveClose => upstream.close(resolveClose)); });
  globalThis.fetch = (_url, options) => nativeFetch(`http://127.0.0.1:${upstream.address().port}`, options);
  const caller = new AbortController();
  const outcome = config.withRuntimeConfig({ apiKey: syntheticKey }, () => config.withRequestSignal(caller.signal,
    () => api.getIpGeolocation({ ip: '8.8.8.8' })));
  const rejected = assert.rejects(outcome, error => error instanceof errors.RequestCancelledError);
  await started.promise; caller.abort(new Error('Synthetic cancellation')); await rejected;
  assert.equal(requests, 1);
});

const sizeCases = [
  ['check_security', { ip: '8.8.8.8', fields: 'security.is_vpn' }, url => assert.equal(url.searchParams.has('fields'), false), /local fields\/excludes will not shrink it.*targeted security fields/],
  ['get_abuse_contact', { ip: '8.8.8.8', fields: 'abuse.emails' }, url => assert.equal(url.searchParams.has('fields'), false), /local fields\/excludes will not shrink it.*targeted abuse fields/],
  ['lookup_asn', { asn: 'AS13335', fields: 'asn.routes.route' }, url => assert.equal(url.searchParams.get('include'), 'routes'), /include datasets.*inferred from fields.*excludes alone do not shrink/],
  ['lookup_asn', { asn: 'AS13335', fields: 'asn.organization' }, url => assert.equal(url.searchParams.has('include'), false), /no optional include datasets.*local fields\/excludes cannot shrink/],
  ['lookup_ip', { ip: '8.8.8.8', fields: 'location.city' }, url => assert.equal(url.searchParams.has('fields'), false), /full core IP response before local projection/],
  ['lookup_ip', { ip: '8.8.8.8', include: 'security', fields: 'security.is_vpn' }, url => assert.equal(url.searchParams.get('fields'), 'security.is_vpn'), /Narrow upstream fields\/excludes or reduce include/],
  ['bulk_security_check', { ips: ['8.8.8.8'], fields: 'security.is_vpn' }, url => assert.equal(url.searchParams.get('fields'), 'security.is_vpn'), /smaller input batch or narrower upstream/],
  ['bulk_parse_user_agent', { uaStrings: ['Synthetic-UA'] }, () => {}, /Use a smaller input batch\./],
  ['parse_user_agent', { uaString: 'Synthetic-UA' }, () => {}, /no upstream response-size selectors/],
  ['get_astronomy_time_series', { lat: '0', long: '0', dateStart: '2026-11-01', dateEnd: '2026-11-02' }, () => {}, /Use a shorter date range/],
];
for (const [name, args, inspect, advice] of sizeCases) {
  test(`${name} oversized download advice follows its actual upstream parameters`, async t => {
    setup(t); let requests = 0;
    globalThis.fetch = async url => {
      requests++; inspect(new URL(url));
      return new Response('{}', { headers: { 'content-length': String(1024 * 1024 + 1) } });
    };
    const call = await session(t), result = await call(name, args);
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.category, 'resource_limit');
    assert.equal(result.structuredContent.error.retryable, false);
    assert.match(result.structuredContent.error.message, advice);
    assert.match(result.structuredContent.error.message, /credits; no automatic retry was made/);
    assert.equal(requests, 1);
  });
}

for (const [method, fields] of [['getSecurity', 'security.is_vpn'], ['getAbuseContact', 'abuse.emails']]) {
  test(`${method} direct upstream field selectors retain accurate size advice`, async t => {
    setup(t); let requests = 0;
    globalThis.fetch = async url => {
      requests++; assert.equal(new URL(url).searchParams.get('fields'), fields);
      return new Response('{}', { headers: { 'content-length': String(1024 * 1024 + 1) } });
    };
    await assert.rejects(config.withRuntimeConfig({ apiKey: syntheticKey }, () => api[method]({ ip: '8.8.8.8', fields })), error => {
      assert.ok(error instanceof errors.ResourceLimitError);
      assert.match(error.message, /Narrow the upstream fields\/excludes/);
      assert.doesNotMatch(error.message, /Changing only local fields/);
      return true;
    });
    assert.equal(requests, 1);
  });
}

async function cli(t, mode = 'normal', settings = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'mcp-transport-hardening-'));
  const preload = join(directory, 'fetch.mjs'), tracePath = join(directory, 'trace.jsonl');
  await writeFile(tracePath, '');
  await writeFile(preload, String.raw`import { appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const trace = event => appendFileSync(process.env.TRANSPORT_FIXTURE_TRACE, JSON.stringify({event})+'\n');
let copiedBytes = 0;
const concat = Buffer.concat;
const copy = Buffer.prototype.copy;
if (process.env.TRANSPORT_FIXTURE_MODE === 'framing') {
  Buffer.concat = (...args) => { const result = concat(...args); copiedBytes += result.byteLength; return result; };
  Buffer.prototype.copy = function(...args) { const count = copy.apply(this, args); copiedBytes += count; return count; };
}
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  if (new URL(url).origin !== 'https://api.ipgeolocation.io') throw new Error('Unexpected fixture destination');
  trace('request');
  if (process.env.TRANSPORT_FIXTURE_MODE === 'framing') appendFileSync(process.env.TRANSPORT_FIXTURE_TRACE, JSON.stringify({event:'copy-count', copiedBytes, bodySha256:createHash('sha256').update(options.body).digest('hex')})+'\n');
  if (process.env.TRANSPORT_FIXTURE_UPSTREAM) return nativeFetch(process.env.TRANSPORT_FIXTURE_UPSTREAM, options);
  if (new URL(url).pathname === '/v3/user-agent') return new Response(JSON.stringify({user_agent_string:'synthetic-framing-result'}));
  if (new URL(url).pathname === '/v3/user-agent-bulk') return new Response(JSON.stringify(JSON.parse(options.body).uaStrings.map(() => ({user_agent_string:'synthetic-framing-result'}))));
  return new Promise((resolve, reject) => {
    const mode = process.env.TRANSPORT_FIXTURE_MODE;
    const finish = () => { options.signal?.removeEventListener('abort', abort); resolve(new Response('{"time_zone":{"name":"UTC"}}')); };
    const timer = setTimeout(finish, mode === 'normal' ? 30 : 10000);
    const fault = ['io-error', 'stderr-error'].includes(mode) ? setTimeout(() => (mode === 'stderr-error' ? process.stderr : process.stdout).emit('error', Object.assign(new Error('Synthetic output fault'), {code:'EIO'})), 20) : undefined;
    const abort = () => { clearTimeout(timer); clearTimeout(fault); trace('abort'); reject(options.signal.reason); };
    options.signal?.addEventListener('abort', abort, {once:true});
    if (options.signal?.aborted) abort();
  });
};
`);
  const env = { ...process.env, TRANSPORT_FIXTURE_MODE: mode, TRANSPORT_FIXTURE_TRACE: tracePath };
  for (const name of Object.keys(env)) if (name.startsWith('IPGEOLOCATION_')) delete env[name];
  Object.assign(env, { IPGEOLOCATION_API_KEY: syntheticKey, IPGEOLOCATION_MCP_MAX_ARGUMENT_BYTES: String(argumentLimit), ...settings });
  const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, join(runtimeRoot, 'cli.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.on('error', () => {});
  let pending = '', stderr = '', exited;
  const replies = [], waiting = new Set();
  const changed = () => { for (const check of [...waiting]) check(); };
  child.stdout.on('data', bytes => {
    pending += bytes;
    for (;;) {
      const index = pending.indexOf('\n'); if (index === -1) break;
      replies.push(JSON.parse(pending.slice(0, index))); pending = pending.slice(index + 1);
    }
    changed();
  });
  child.stderr.on('data', bytes => { stderr += bytes; });
  const closed = new Promise((resolveClose, reject) => {
    child.once('close', (code, signal) => { exited = { code, signal }; changed(); resolveClose(exited); });
    child.once('error', reject);
  });
  t.after(async () => {
    if (!exited) { child.kill('SIGKILL'); await closed; }
    await rm(directory, { recursive: true, force: true });
  });
  const reply = id => new Promise((resolveReply, reject) => {
    const timeout = setTimeout(() => { waiting.delete(check); reject(new Error(`Timed out waiting for reply ${id}`)); }, 5000);
    const check = () => {
      const value = replies.find(item => item.id === id); if (!value && !exited) return;
      clearTimeout(timeout); waiting.delete(check);
      if (value) resolveReply(value); else reject(new Error(`CLI exited before reply ${id}: ${JSON.stringify(exited)}`));
    };
    waiting.add(check); check();
  });
  const send = message => child.stdin.write(JSON.stringify(message) + '\n');
  send({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'transport-hardening', version: '1' } } });
  assert.equal((await reply(0)).error, undefined);
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const trace = async () => (await readFile(tracePath, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  return { child, closed, reply, send, trace, stderr: () => stderr };
}

for (const [label, character, escaped] of [['literal DEL', '\u007f', false], ['escaped DEL', '\u007f', true], ['escaped ASCII', 'x', true]]) {
  test(`stdio admits a valid ${label} batch with one request`, { timeout: 10000 }, async t => {
    const run = await cli(t), args = { uaStrings: Array.from({ length: 8 }, () => character.repeat(7500)) };
    let frame = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'bulk_parse_user_agent', arguments: args } }) + '\n';
    if (escaped) frame = frame.replaceAll(character, `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
    assert.equal(Buffer.byteLength(JSON.stringify(args)), 60039);
    assert.equal(Buffer.byteLength(frame), escaped ? 360141 : 60141);
    run.child.stdin.write(frame);
    const result = await run.reply(2);
    assert.equal(result.error, undefined); assert.equal(result.result.isError, undefined);
    assert.equal(result.result.structuredContent.items.length, 8);
    assert.equal((await run.trace()).filter(item => item.event === 'request').length, 1);
    run.child.stdin.end(); assert.deepEqual(await run.closed, { code: 0, signal: null });
  });
}

test('stdio rejects decoded arguments over budget while the smaller wire frame remains valid', { timeout: 10000 }, async t => {
  const run = await cli(t);
  run.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'bulk_parse_user_agent', arguments: { uaStrings: ['x'.repeat(argumentLimit)] } } });
  const result = await run.reply(2);
  assert.equal(result.result.isError, true);
  assert.equal(result.result.structuredContent.error.category, 'resource_limit');
  assert.equal((await run.trace()).length, 0);
  run.send({ jsonrpc: '2.0', id: 3, method: 'ping' }); assert.equal((await run.reply(3)).error, undefined);
  run.child.stdin.end(); assert.deepEqual(await run.closed, { code: 0, signal: null });
});

test('stdio enforces its separate wire cap for an unfinished whitespace frame', { timeout: 10000 }, async t => {
  const run = await cli(t);
  run.child.stdin.write(Buffer.alloc(wireLimit + 1, 32));
  assert.deepEqual(await run.closed, { code: 0, signal: null });
  assert.match(run.stderr(), new RegExp(`${wireLimit}-byte wire-buffer cap`));
  assert.equal((await run.trace()).length, 0);
});

test('stdout reader disconnect aborts the pending request and exits cleanly', { timeout: 10000 }, async t => {
  const run = await cli(t, 'pending');
  run.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_timezone', arguments: { tz: 'UTC' } } });
  const started = performance.now();
  while ((await run.trace()).length === 0 && performance.now() - started < 3000) await delay(10);
  assert.equal((await run.trace()).filter(item => item.event === 'request').length, 1);
  const stdoutClosed = new Promise(resolveClose => run.child.stdout.once('close', resolveClose));
  run.child.stdout.destroy(); await stdoutClosed;
  run.send({ jsonrpc: '2.0', id: 3, method: 'ping' });
  assert.deepEqual(await run.closed, { code: 0, signal: null });
  assert.equal((await run.trace()).filter(item => item.event === 'abort').length, 1);
  assert.doesNotMatch(run.stderr(), /Unhandled|EPIPE|output failed/);
  assert.ok(performance.now() - started < 3000, 'disconnect must clear the pending timer');
});

test('unrelated stdout errors fail visibly and abort outstanding work', { timeout: 10000 }, async t => {
  const run = await cli(t, 'io-error'), started = performance.now();
  run.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_timezone', arguments: { tz: 'UTC' } } });
  assert.deepEqual(await run.closed, { code: 1, signal: null });
  assert.match(run.stderr(), /MCP stdio output failed/); assert.doesNotMatch(run.stderr(), /Unhandled/);
  const trace = await run.trace();
  assert.equal(trace.filter(item => item.event === 'request').length, 1);
  assert.equal(trace.filter(item => item.event === 'abort').length, 1);
  assert.ok(performance.now() - started < 3000);
});

test('stdin-only EOF still permits the final tool response', { timeout: 10000 }, async t => {
  const run = await cli(t);
  run.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_timezone', arguments: { tz: 'UTC' } } });
  run.child.stdin.end();
  const result = await run.reply(2);
  assert.equal(result.result.isError, undefined);
  assert.equal(result.result.structuredContent.data.time_zone.name, 'UTC');
  assert.deepEqual(await run.closed, { code: 0, signal: null });
  assert.deepEqual((await run.trace()).map(item => item.event), ['request']);
});

test('fragmented escaped stdio frames use a linear copying budget', { timeout: 10000 }, async t => {
  const run = await cli(t, 'framing');
  const args = { uaStrings: Array.from({ length: 8 }, () => 'x'.repeat(7500)) };
  const frame = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'bulk_parse_user_agent', arguments: args } }).replaceAll('x', '\\u0078') + '\n';
  for (let offset = 0; offset < frame.length; offset += 4096) {
    run.child.stdin.write(frame.slice(offset, offset + 4096));
    await delay(1);
  }
  const result = await run.reply(2);
  assert.equal(result.result.isError, undefined);
  assert.equal(result.result.structuredContent.items.length, 8);
  const trace = await run.trace();
  assert.equal(trace.filter(item => item.event === 'request').length, 1);
  const copied = trace.find(item => item.event === 'copy-count').copiedBytes;
  assert.ok(copied <= 4 * Buffer.byteLength(frame), 'copying ' + copied + ' bytes for a ' + Buffer.byteLength(frame) + '-byte frame exceeds a linear budget');
  run.child.stdin.end();
  assert.deepEqual(await run.closed, { code: 0, signal: null });
});

test('closed stderr does not interrupt valid MCP calls or pending work', { timeout: 10000 }, async t => {
  const run = await cli(t);
  run.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_timezone', arguments: { tz: 'UTC' } } });
  const stderrClosed = new Promise(resolveClose => run.child.stderr.once('close', resolveClose));
  run.child.stderr.destroy(); await stderrClosed;
  run.child.stdin.write('{bad JSON}\n');
  await delay(50);
  run.child.stdin.write('{more bad JSON}\n');
  run.send({ jsonrpc: '2.0', id: 3, method: 'ping' });
  assert.equal((await run.reply(3)).error, undefined);
  assert.equal((await run.reply(2)).result.isError, undefined);
  run.child.stdin.end();
  assert.deepEqual(await run.closed, { code: 0, signal: null });
  assert.deepEqual((await run.trace()).map(item => item.event), ['request']);
});

test('stdio preserves split UTF-8 bytes, CRLF and adjacent complete frames', { timeout: 10000 }, async t => {
  const run = await cli(t, 'framing');
  const args = { uaStrings: ['é☃😀\u0000\r\n"\\', '  Original user agent  '] };
  const frame = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'bulk_parse_user_agent', arguments: args } }) + '\r\n' +
    '{"jsonrpc":"2.0","id":3,"method":"ping"}\n');
  for (const byte of frame) { run.child.stdin.write(Buffer.from([byte])); await delay(1); }
  assert.equal((await run.reply(2)).result.isError, undefined);
  assert.equal((await run.reply(3)).error, undefined);
  const trace = await run.trace();
  assert.equal(trace.filter(item => item.event === 'request').length, 1);
  assert.equal(trace.find(item => item.event === 'copy-count').bodySha256, createHash('sha256').update(JSON.stringify(args)).digest('hex'));
  run.child.stdin.end(); assert.deepEqual(await run.closed, { code: 0, signal: null });
});

test('unexpected stderr failures close outstanding work with a failing exit', { timeout: 10000 }, async t => {
  const run = await cli(t, 'stderr-error');
  run.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_timezone', arguments: { tz: 'UTC' } } });
  assert.deepEqual(await run.closed, { code: 1, signal: null });
  assert.equal((await run.trace()).filter(item => item.event === 'abort').length, 1);
  assert.doesNotMatch(run.stderr(), /Unhandled|Synthetic output fault/);
});

for (const [label, status, headers, firstChunk, category] of [
  ['oversized declared success', 200, { 'content-length': String(64 * 1024 * 1024) }, '', 'resource_limit'],
  ['oversized streamed success', 200, {}, 'x'.repeat(1024 * 1024 + 1), 'resource_limit'],
  ['oversized error', 401, { 'content-length': String(64 * 1024 * 1024) }, '', 'authentication'],
  ['blocked redirect', 302, { location: 'https://example.invalid' }, '', 'redirect_blocked'],
]) {
  test(label + ' releases the native upstream socket and permits EOF exit', { timeout: 10000 }, async t => {
    let requests = 0, requestSocket;
    const upstream = createServer((request, response) => {
      requests++; requestSocket = request.socket; request.resume();
      response.writeHead(status, headers); response.flushHeaders();
      if (firstChunk) response.write(firstChunk);
    });
    await new Promise(resolveListen => upstream.listen(0, '127.0.0.1', resolveListen));
    t.after(async () => { upstream.closeAllConnections(); await new Promise(resolveClose => upstream.close(resolveClose)); });
    const run = await cli(t, 'normal', {
      TRANSPORT_FIXTURE_UPSTREAM: 'http://127.0.0.1:' + upstream.address().port,
      IPGEOLOCATION_UPSTREAM_MAX_RESPONSE_BYTES: String(1024 * 1024),
      IPGEOLOCATION_REQUEST_TIMEOUT_MS: '10000',
    });
    run.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_timezone', arguments: { tz: 'UTC' } } });
    const result = await run.reply(2);
    assert.equal(result.result.isError, true);
    assert.equal(result.result.structuredContent.error.category, category);
    assert.equal(requests, 1);
    const started = performance.now();
    while (!requestSocket.destroyed && performance.now() - started < 1500) await delay(10);
    assert.equal(requestSocket.destroyed, true, 'the rejected upstream response must not retain its socket');
    run.child.stdin.end();
    assert.deepEqual(await Promise.race([run.closed, delay(2500).then(() => { throw new Error('CLI remained alive after EOF'); })]), { code: 0, signal: null });
  });
}

for (const [name, emptyArgs, property, array] of [
  ['parse_user_agent', { uaString: '' }, 'uaString', false],
  ['bulk_parse_user_agent', { uaStrings: [''] }, 'uaStrings', true],
]) {
  test(name + ' accepts the exact decoded argument limit and rejects one byte more', { timeout: 10000 }, async t => {
    const run = await cli(t);
    const fill = 'x'.repeat(argumentLimit - Buffer.byteLength(JSON.stringify(emptyArgs)));
    const args = { [property]: array ? [fill] : fill };
    assert.equal(Buffer.byteLength(JSON.stringify(args)), argumentLimit);
    run.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
    assert.equal((await run.reply(2)).result.isError, undefined);
    run.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: { [property]: array ? [fill + 'x'] : fill + 'x' } } });
    assert.equal((await run.reply(3)).result.structuredContent.error.category, 'resource_limit');
    assert.equal((await run.trace()).filter(item => item.event === 'request').length, 1);
    run.child.stdin.end(); assert.deepEqual(await run.closed, { code: 0, signal: null });
  });
}

test('direct POST clients apply one logical argument budget across query and body', async t => {
  setup(t);
  const previous = process.env.IPGEOLOCATION_MCP_MAX_ARGUMENT_BYTES;
  process.env.IPGEOLOCATION_MCP_MAX_ARGUMENT_BYTES = String(argumentLimit);
  t.after(() => { if (previous === undefined) delete process.env.IPGEOLOCATION_MCP_MAX_ARGUMENT_BYTES; else process.env.IPGEOLOCATION_MCP_MAX_ARGUMENT_BYTES = previous; });
  for (const [method, base, property, array] of [
    ['parseUserAgent', { uaString: '' }, 'uaString', false],
    ['parseUserAgentBulk', { uaStrings: [''] }, 'uaStrings', true],
    ['getIpGeolocationBulk', { ips: ['192.0.2.1'], include: 'security', fields: '' }, 'fields', false],
    ['getSecurityBulk', { ips: ['192.0.2.1'], fields: '' }, 'fields', false],
  ]) {
    let requests = 0;
    globalThis.fetch = async (_url, options) => {
      requests++;
      const body = JSON.parse(options.body);
      return new Response(JSON.stringify(body.ips || body.uaStrings ? [{}] : {}));
    };
    const fill = 'x'.repeat(argumentLimit - Buffer.byteLength(JSON.stringify(base)));
    const args = { ...base, [property]: array ? [fill] : fill };
    assert.equal(Buffer.byteLength(JSON.stringify(args)), argumentLimit);
    await config.withRuntimeConfig({ apiKey: syntheticKey }, () => api[method](args));
    await assert.rejects(config.withRuntimeConfig({ apiKey: syntheticKey }, () => api[method]({
      ...args, [property]: array ? [fill + 'x'] : fill + 'x',
    })), error => error instanceof errors.ResourceLimitError);
    assert.equal(requests, 1, method);
  }
});

for (const [name, base] of [['lookup_ip', { ip: '192.0.2.1', fields: '' }], ['bulk_lookup_ip', { ips: ['192.0.2.1'], fields: '' }]]) {
  test(name + ' keeps the original argument budget when fields infer include modules', async t => {
    setup(t);
    const previous = process.env.IPGEOLOCATION_MCP_MAX_ARGUMENT_BYTES;
    process.env.IPGEOLOCATION_MCP_MAX_ARGUMENT_BYTES = String(argumentLimit);
    t.after(() => { if (previous === undefined) delete process.env.IPGEOLOCATION_MCP_MAX_ARGUMENT_BYTES; else process.env.IPGEOLOCATION_MCP_MAX_ARGUMENT_BYTES = previous; });
    const remaining = argumentLimit - Buffer.byteLength(JSON.stringify(base)) + 1;
    let fields;
    for (let securityCount = 1; securityCount < 14; securityCount++) {
      const companyChars = remaining - 'security.is_vpn,'.length * securityCount;
      if (companyChars % 'company.name,'.length === 0) {
        fields = ('company.name,'.repeat(companyChars / 'company.name,'.length) + 'security.is_vpn,'.repeat(securityCount)).slice(0, -1);
        break;
      }
    }
    assert.ok(fields);
    const args = { ...base, fields };
    assert.equal(Buffer.byteLength(JSON.stringify(args)), argumentLimit);
    let requests = 0;
    globalThis.fetch = async (url, options) => {
      requests++;
      const request = new URL(url);
      assert.equal(request.searchParams.get('include'), 'security');
      const logical = { ...Object.fromEntries(request.searchParams), ...(options.body ? JSON.parse(options.body) : {}) };
      assert.ok(Buffer.byteLength(JSON.stringify(logical)) > argumentLimit, 'inferred parameters extend the wire representation only');
      const data = { ip: '192.0.2.1', company: { name: 'Synthetic Company' }, security: { is_vpn: false } };
      return new Response(JSON.stringify(name.startsWith('bulk_') ? [data] : data));
    };
    const call = await session(t);
    assert.equal((await call(name, args)).isError, undefined);
    const oversized = { ...args, fields: fields + ',' };
    assert.equal((await call(name, oversized)).structuredContent.error.category, 'resource_limit');
    const directMethod = name === 'lookup_ip' ? 'getIpGeolocation' : 'getIpGeolocationBulk';
    await assert.rejects(config.withRuntimeConfig({ apiKey: syntheticKey }, () => api[directMethod](oversized)), error => error instanceof errors.ResourceLimitError);
    assert.equal(requests, 1, 'derived MCP requests pass but oversized MCP and direct-client inputs both fail locally');
  });
}

test('validated MCP argument scopes do not leak into concurrent or later direct calls', async t => {
  setup(t);
  const previous = process.env.IPGEOLOCATION_MCP_MAX_ARGUMENT_BYTES;
  process.env.IPGEOLOCATION_MCP_MAX_ARGUMENT_BYTES = String(argumentLimit);
  t.after(() => { if (previous === undefined) delete process.env.IPGEOLOCATION_MCP_MAX_ARGUMENT_BYTES; else process.env.IPGEOLOCATION_MCP_MAX_ARGUMENT_BYTES = previous; });
  const call = await session(t);
  const checkDirect = () => assert.rejects(config.withRuntimeConfig({ apiKey: syntheticKey }, () =>
    api.getTimezone({ location: 'x'.repeat(argumentLimit) })), error => error instanceof errors.ResourceLimitError);
  for (const outcome of ['success', 'failure', 'cancel']) {
    const started = Promise.withResolvers(), gate = Promise.withResolvers();
    let requests = 0;
    globalThis.fetch = async (_url, options) => {
      requests++;
      const abort = () => gate.reject(options.signal.reason);
      options.signal.addEventListener('abort', abort, { once: true });
      started.resolve();
      try { return await gate.promise; }
      finally { options.signal.removeEventListener('abort', abort); }
    };
    const caller = new AbortController();
    const pending = call('get_timezone', { tz: 'UTC' }, { signal: caller.signal });
    const settled = pending.then(value => ({ value }), error => ({ error }));
    await started.promise;
    await checkDirect();
    await config.withRuntimeConfig({ apiKey: 'nested-runtime-synthetic-key' }, checkDirect);
    if (outcome === 'cancel') caller.abort(new Error('Synthetic caller cancellation'));
    else if (outcome === 'failure') gate.reject(new Error('Synthetic upstream failure'));
    else gate.resolve(new Response('{"time_zone":{"name":"UTC"}}'));
    const result = await settled;
    if (outcome === 'cancel') assert.ok(result.error);
    else assert.equal(result.value.isError, outcome === 'failure' ? true : undefined);
    await checkDirect();
    assert.equal(requests, 1, 'direct calls outside the MCP handler must stay bounded during ' + outcome);
  }
  let unexpectedRequests = 0;
  globalThis.fetch = async () => { unexpectedRequests++; throw new Error('Unexpected request'); };
  for (const args of [{ tz: 42 }, { tz: 'UTC', unknown: true }, { location: 'x'.repeat(argumentLimit) }]) {
    assert.equal((await call('get_timezone', args)).isError, true);
    await checkDirect();
  }
  assert.equal(unexpectedRequests, 0);
});

test('malformed tool call parameters return concise invalid-params errors without echoes', { timeout: 10000 }, async t => {
  const run = await cli(t);
  const cases = [undefined, {}, { name: 5 }, { name: null }, { name: [] }, { name: { secret: syntheticKey } }, { name: 'get_my_ip', arguments: [] }];
  for (const [index, params] of cases.entries()) {
    const id = index + 2;
    run.send({ jsonrpc: '2.0', id, method: 'tools/call', ...(params === undefined ? {} : { params }) });
    const result = await run.reply(id);
    assert.equal(result.error.code, -32602);
    assert.match(result.error.message, /Invalid tools\/call request/);
    assert.doesNotMatch(result.error.message, /invalid_type|expected|path|Zod|transport-hardening-synthetic-key/);
  }
  run.send({ jsonrpc: '2.0', id: 99, method: 'ping' });
  assert.equal((await run.reply(99)).error, undefined);
  assert.equal((await run.trace()).length, 0);
  run.child.stdin.end(); assert.deepEqual(await run.closed, { code: 0, signal: null });
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`${signal} shuts down the connected server and aborts outstanding work`, { timeout: 10000, skip: process.platform === 'win32' && 'Windows does not deliver POSIX termination signals' }, async t => {
    const run = await cli(t, 'pending');
    run.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_timezone', arguments: { tz: 'UTC' } } });
    const started = performance.now();
    while ((await run.trace()).length === 0 && performance.now() - started < 3000) await delay(10);
    assert.equal((await run.trace()).filter(item => item.event === 'request').length, 1);
    assert.equal(run.child.kill(signal), true);
    assert.deepEqual(await run.closed, { code: 0, signal: null });
    assert.equal((await run.trace()).filter(item => item.event === 'abort').length, 1);
    assert.doesNotMatch(run.stderr(), /Unhandled|shutdown failed|output failed/);
    assert.ok(performance.now() - started < 3000, 'shutdown must clear the pending timer');
  });
}
