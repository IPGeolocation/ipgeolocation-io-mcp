import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

// These boundary checks use only local fixtures and loopback HTTP servers.
// SERVER_RUNTIME_ROOT may select another built runtime; no provider access is used.
const runtimeRoot = resolve(process.env.SERVER_RUNTIME_ROOT ?? fileURLToPath(new URL("../dist", import.meta.url)));
const runtime = name => import(pathToFileURL(join(runtimeRoot, name)).href);
const [api, config, cache, pagination, response, errors, serverModule] = await Promise.all([
  runtime('client.js'), runtime('config.js'), runtime('tools/cache.js'), runtime('tools/pagination.js'),
  runtime('tools/response.js'), runtime('errors.js'), runtime('index.js'),
]);
const { ResourceLimitError } = errors;
const MiB = 1024 * 1024;
const syntheticA = 'synthetic-session-a-0123456789abcdef';
const syntheticB = 'synthetic-session-b-fedcba9876543210';
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const scoped = callback => config.withRuntimeConfig({ apiKey: syntheticA }, callback);

for (const mode of ['deep', 'cached-empty-arrays']) test(`large ${mode} responses reconstruct under a bounded heap without another request`, {timeout: 90000}, () => {
 const env = {...process.env, SERVER_RUNTIME_ROOT: runtimeRoot};
 for (const key of Object.keys(env)) if (key.startsWith('IPGEOLOCATION_')) delete env[key];
 const child = spawnSync(process.execPath, [
  '--max-old-space-size=256', fileURLToPath(new URL('./fixtures/large-response.fixture.mjs', import.meta.url)),
  ...(mode === 'cached-empty-arrays' ? ['--cached-empty-arrays'] : []),
 ], {env, encoding: 'utf8', timeout: 85000, maxBuffer: 1024 * 1024});
 assert.equal(child.status, 0, child.error?.message || child.stderr);
 const result = JSON.parse(child.stdout.trim());
 assert.equal(result.complete, true);
 assert.equal(result.upstreamRequests, 1);
 assert.ok(result.pages > 1);
});
const envNames = [
  'IPGEOLOCATION_API_KEY', 'IPGEOLOCATION_REQUEST_TIMEOUT_MS', 'IPGEOLOCATION_MCP_CACHE_TTL_MS',
  'IPGEOLOCATION_MCP_CACHE_MAX_ENTRIES', 'IPGEOLOCATION_MCP_CACHE_MAX_BYTES',
  'IPGEOLOCATION_UPSTREAM_MAX_RESPONSE_BYTES', 'IPGEOLOCATION_MCP_MAX_ARGUMENT_BYTES',
  'IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS', 'IPGEOLOCATION_MCP_MAX_ERROR_CHARS',
];

function setup(t, overrides = {}) {
  const previous = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  Object.assign(process.env, {
    IPGEOLOCATION_API_KEY: syntheticA,
    IPGEOLOCATION_REQUEST_TIMEOUT_MS: '1000',
    IPGEOLOCATION_MCP_CACHE_TTL_MS: '1000',
    IPGEOLOCATION_MCP_CACHE_MAX_ENTRIES: '500',
    IPGEOLOCATION_MCP_CACHE_MAX_BYTES: String(4 * MiB),
    IPGEOLOCATION_UPSTREAM_MAX_RESPONSE_BYTES: String(MiB),
    IPGEOLOCATION_MCP_MAX_ARGUMENT_BYTES: '65536',
    IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS: '10000',
    IPGEOLOCATION_MCP_MAX_ERROR_CHARS: '4000',
    ...overrides,
  });
  cache.clearToolCacheForTests();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Unexpected external access blocked by independent readiness test'); };
  t.after(() => {
    globalThis.fetch = originalFetch;
    cache.clearToolCacheForTests();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  return originalFetch;
}

function mock(responder) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const call = { url: new URL(input), init, key: new Headers(init.headers).get('x-ipgeolocation-api-key') };
    assert.equal(call.url.origin, 'https://api.ipgeolocation.io');
    calls.push(call);
    return responder(call, calls.length);
  };
  return calls;
}

async function session(t, apiKey = syntheticA) {
  const server = serverModule.createMcpServer({ apiKey });
  const client = new Client({ name: 'independent-readiness-security', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  t.after(async () => { await client.close(); await server.close(); });
  return { call: (name, args = {}) => client.callTool({ name, arguments: args }) };
}

function resourceResult(result) {
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error.source, 'mcp_server');
  assert.equal(result.structuredContent.error.category, 'resource_limit');
  assert.equal(result.structuredContent.error.retryable, false);
  assert.equal(result.structuredContent.page, undefined);
}

async function collectResult(client, result) {
 let text = '', count = 0;
 while (result.structuredContent.page) {
  assert.ok(!JSON.stringify(result).includes(syntheticA));
  const page = result.structuredContent.page;
  assert.equal(page.offset, text.length);
  text += page.json_fragment;
  assert.ok(++count < 1000);
  if (!page.next_cursor) return JSON.parse(text);
  result = await client.call('get_cached_result', {cursor: page.next_cursor});
  assert.equal(result.isError, undefined);
 }
 return result.structuredContent;
}

for (const paged of [false, true]) test(`redacted ${paged ? 'paged' : 'inline'} results preserve secret keys, values and the cached source`, async t => {
 setup(t);
 const payload = Object.fromEntries([
  ['ip', '8.8.8.8'], [syntheticA, `echo ${syntheticA}`],
  ['api_key', {nested: syntheticA}], ['__proto__', {echo: syntheticA}],
  ['details', paged ? 'large synthetic result '.repeat(2500) : 'small'],
 ]);
 const original = JSON.stringify(payload), calls = mock(() => json(payload));
 const client = await session(t);
 const first = await client.call('lookup_ip', {ip: '8.8.8.8'});
 assert.equal(Boolean(first.structuredContent.page), paged);
 const recovered = await collectResult(client, first);
 assert.ok(!JSON.stringify(recovered).includes(syntheticA));
 assert.equal(recovered.data['[REDACTED_API_KEY]'], 'echo [REDACTED_API_KEY]');
 assert.equal(recovered.data.api_key, '[REDACTED_API_KEY]');
 assert.equal(recovered.data.__proto__.echo, '[REDACTED_API_KEY]');
 assert.equal(JSON.stringify(payload), original);
 assert.deepEqual((await collectResult(client, await client.call('lookup_ip', {ip: '8.8.8.8'}))).data, recovered.data);
 assert.equal(calls.length, 1);
});

test('paged bulk errors redact input IDs and messages before snapshot storage', async t => {
 setup(t);
 const calls = mock(() => json([
  {ip: '8.8.8.8', details: 'large synthetic result '.repeat(2500)},
  {message: `Synthetic unavailable ${syntheticA}`, status: 503},
 ]));
 const client = await session(t);
 const result = await client.call('bulk_lookup_ip', {ips: ['8.8.8.8', syntheticA]});
 assert.ok(result.structuredContent.page);
 const recovered = await collectResult(client, result);
 assert.ok(!JSON.stringify(recovered).includes(syntheticA));
 assert.equal(recovered.errors[0].input, '[REDACTED_API_KEY]');
 assert.equal(recovered.errors[0].message, 'Synthetic unavailable [REDACTED_API_KEY]');
 assert.equal(recovered.errors[0].input_index, 1);
 assert.equal(calls.length, 1);
});

function streamingBody(totalBytes, headers = {}, status = 200) {
  const observed = { produced: 0, cancelled: false };
  const body = new ReadableStream({
    pull(controller) {
      if (observed.produced >= totalBytes) return controller.close();
      const size = Math.min(65536, totalBytes - observed.produced);
      const chunk = Buffer.alloc(size, 120);
      observed.produced += size;
      controller.enqueue(chunk);
    },
    cancel() { observed.cancelled = true; },
  });
  return { observed, response: new Response(body, { status, headers }) };
}

test('resource errors retain category, nonretryability, size bound and redaction', t => {
  setup(t);
  const result = scoped(() => response.errorToolResponse(new ResourceLimitError(`Synthetic limit ${syntheticA}`)));
  resourceResult(result);
  assert.ok(!JSON.stringify(result).includes(syntheticA));
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 10000);
});

for (const [label, malformedKey] of [['high', 'synthetic-\ud800'], ['low', 'synthetic-\udc00']]) {
 test(`malformed ${label}-surrogate key cannot break structured error redaction`, async t => {
  setup(t);
  const redaction = await runtime('redaction.js');
  const sanitized = config.withRuntimeConfig({apiKey: malformedKey}, () => redaction.redactSensitiveText(`Key ${malformedKey}`));
  assert.equal(sanitized, 'Key [REDACTED_API_KEY]');
  const calls = mock(() => json({message: 'Synthetic unavailable'}, 503));
  const client = await session(t, malformedKey);
  const protectedResult = await client.call('lookup_ip', {ip: '8.8.8.8'});
  assert.equal(protectedResult.isError, true);
  assert.equal(protectedResult.structuredContent.error.source, 'mcp_server');
  assert.equal(calls.length, 0);
  const keylessResult = await client.call('get_my_ip');
  assert.equal(keylessResult.isError, true);
  assert.equal(keylessResult.structuredContent.error.source, 'ipgeolocation_api');
  assert.equal(keylessResult.structuredContent.error.status, 503);
  assert.equal(calls.length, 1);
  assert.ok(!JSON.stringify([protectedResult, keylessResult]).includes(malformedKey));
 });
}

test('cache byte ceiling includes full input keys and refuses oversized replacement without stale data', t => {
  setup(t);
  assert.equal(config.getCacheMaxBytes(), 4 * MiB);
  scoped(() => {
    const hugeKey = 'UA-input|' + 'x'.repeat(3 * MiB);
    assert.equal(cache.setCachedValue(hugeKey, 'y'.repeat(2 * MiB)), false);
    assert.equal(cache.getCachedValue(hugeKey), undefined);
    assert.equal(cache.setCachedValue('replacement', { notes: 'small' }), true);
    assert.equal(cache.setCachedValue('replacement', { notes: 'x'.repeat(4 * MiB) }), false);
    assert.equal(cache.getCachedValue('replacement'), undefined);
  });
});

test('LRU promotion preserves hot data and leaves normal fixed TTL unchanged', t => {
  setup(t);
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  t.after(() => { Date.now = originalNow; });
  scoped(() => {
    for (const key of ['a', 'b', 'c']) assert.equal(cache.setCachedValue(key, 'x'.repeat(MiB)), true);
    now += 900;
    assert.ok(cache.getCachedValue('a'));
    assert.equal(cache.setCachedValue('d', 'x'.repeat(MiB)), true);
    assert.ok(cache.getCachedValue('a'));
    assert.equal(cache.getCachedValue('b'), undefined);
    now += 101;
    assert.equal(cache.getCachedValue('a'), undefined, 'ordinary cache reads must not extend source-response TTL');
    assert.ok(cache.getCachedValue('d'));
  });
});

test('replacement, expiry and clearing release weighted capacity', t => {
  setup(t);
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  t.after(() => { Date.now = originalNow; });
  scoped(() => {
    cache.setCachedValue('a', 'x'.repeat(3 * MiB));
    cache.setCachedValue('a', 'x'.repeat(MiB));
    assert.equal(cache.setCachedValue('b', 'x'.repeat(2 * MiB)), true);
    assert.ok(cache.getCachedValue('a'));
    now += 1001;
    assert.equal(cache.getCachedValue('a'), undefined);
    assert.equal(cache.setCachedValue('c', 'x'.repeat(3 * MiB)), true);
    assert.ok(cache.getCachedValue('c'));
    cache.clearToolCacheForTests();
    assert.equal(cache.setCachedValue('d', 'x'.repeat(3 * MiB)), true);
    assert.ok(cache.getCachedValue('d'));
  });
});

test('no page cursor is returned for a snapshot that cannot be retained', async t => {
  setup(t, { IPGEOLOCATION_UPSTREAM_MAX_RESPONSE_BYTES: String(8 * MiB) });
  const calls = mock(() => json({ asn: { as_number: 'AS1', whois_response: 'x'.repeat(5 * MiB) } }));
  const { call } = await session(t);
  const result = await call('lookup_asn', { asn: 'AS1', include: 'whois_response' });
  resourceResult(result);
  assert.ok(!JSON.stringify(result).includes('next_cursor'));
  assert.ok(calls.length <= 1, 'failure must never automatically repeat the paid lookup');
});

test('large legitimate results reconstruct every record and nested value with zero page fetches', async t => {
  setup(t, { IPGEOLOCATION_MCP_CACHE_TTL_MS: '300000' });
  const source = { asn: { as_number: 'AS1', routes: Array.from({ length: 2000 }, (_, i) => `192.0.${i % 256}.0/24`), whois_response: 'opaque \\"\n😀界'.repeat(16000) } };
  const calls = mock(() => json(source));
  const { call } = await session(t);
  let result = await call('lookup_asn', { asn: 'AS1', include: 'routes,whois_response' });
  assert.equal(result.isError, undefined);
  const first = result.structuredContent.page;
  assert.ok(first.next_cursor);
  const replay = await call('get_cached_result', { cursor: first.cursor });
  assert.equal(replay.structuredContent.page.json_fragment, first.json_fragment);
  let recovered = '', count = 0;
  for (;;) {
    const page = result.structuredContent.page;
    assert.equal(page.offset, recovered.length);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 10000);
    recovered += page.json_fragment;
    assert.ok(++count < 250);
    if (!page.next_cursor) break;
    result = await call('get_cached_result', { cursor: page.next_cursor });
    assert.equal(result.isError, undefined);
  }
  assert.deepEqual(JSON.parse(recovered), { data: source });
  assert.equal(calls.length, 1);
});

for (const [label, headers] of [
  ['no Content-Length', {}], ['dishonest small Content-Length', { 'content-length': '1' }],
  ['declared excessive Content-Length', { 'content-length': String(2 * MiB) }],
]) {
  test(`oversized success stream is cancelled without truncation: ${label}`, async t => {
    setup(t);
    const body = streamingBody(2 * MiB, headers);
    mock(() => body.response);
    await assert.rejects(scoped(() => api.getIpGeolocation({ ip: '8.8.8.8' })), error => error instanceof ResourceLimitError);
    assert.equal(body.observed.cancelled, true);
    assert.ok(body.observed.produced < 2 * MiB);
  });
}

test('UTF-8 decoding keeps split multibyte sequences and strips a BOM', async t => {
  setup(t);
  const expected = { ip: '8.8.8.8', notes: '😀界' };
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(expected))]);
  const chunks = [...bytes].map(byte => Uint8Array.of(byte));
  mock(() => new Response(new ReadableStream({ pull(controller) { chunks.length ? controller.enqueue(chunks.shift()) : controller.close(); } })));
  assert.deepEqual(await scoped(() => api.getIpGeolocation({ ip: '8.8.8.8' })), expected);
});

test('invalid UTF-8 fails locally and does not poison the successful-response cache', async t => {
  setup(t);
  const invalid = Buffer.concat([Buffer.from('{"notes":"'), Buffer.from([0xc3, 0x28]), Buffer.from('"}')]);
  const calls = mock((_request, n) => n === 1 ? new Response(invalid) : json({ ip: '8.8.8.8' }));
  const { call } = await session(t);
  const first = await call('lookup_ip', { ip: '8.8.8.8' });
  assert.equal(first.isError, true);
  assert.equal(first.structuredContent.error.source, 'mcp_server');
  const recovered = await call('lookup_ip', { ip: '8.8.8.8' });
  assert.equal(recovered.isError, undefined);
  assert.equal(calls.length, 2);
});

test('malformed JSON fails locally and does not poison the successful-response cache', async t => {
  setup(t);
  const calls = mock((_request, n) => n === 1 ? new Response('{"notes":') : json({ ip: '8.8.8.8' }));
  const { call } = await session(t);
  assert.equal((await call('lookup_ip', { ip: '8.8.8.8' })).isError, true);
  assert.equal((await call('lookup_ip', { ip: '8.8.8.8' })).isError, undefined);
  assert.equal(calls.length, 2);
});

test('over-depth JSON is rejected before recursive formatting and before caching', async t => {
  setup(t);
  const deep = '{"nested":'.repeat(80) + '1' + '}'.repeat(80);
  const calls = mock((_request, n) => n === 1 ? new Response(deep) : json({ ip: '8.8.8.8' }));
  const { call } = await session(t);
  const first = await call('lookup_ip', { ip: '8.8.8.8' });
  assert.equal(first.isError, true);
  assert.equal(first.structuredContent.error.category, "upstream_response");
  assert.equal(first.structuredContent.error.retryable, false);
  assert.ok(!JSON.stringify(first).includes('call stack'));
  assert.equal((await call('lookup_ip', { ip: '8.8.8.8' })).isError, undefined);
  assert.equal(calls.length, 2);
});

for (const [name, field, input] of [
  ['bulk_lookup_ip', 'ips', '8.8.8.8'], ['bulk_security_check', 'ips', '8.8.8.8'], ['bulk_parse_user_agent', 'uaStrings', 'Mozilla/5.0'],
]) {
  test(`${name}: malformed top-level shape, item shape and item count never poison cache`, async t => {
    setup(t);
    const { call } = await session(t);
    for (const invalid of [null, {}, [], [{}, {}], [null], ['not an object']]) {
      cache.clearToolCacheForTests();
      const calls = mock((_request, n) => json(n === 1 ? invalid : [{ ip: '8.8.8.8', user_agent_string: input }]));
      assert.equal((await call(name, { [field]: [input] })).isError, true, JSON.stringify(invalid));
      assert.equal((await call(name, { [field]: [input] })).isError, undefined, JSON.stringify(invalid));
      assert.equal(calls.length, 2);
    }
  });
}

test('single-result null, array and primitive shapes never poison cache', async t => {
  setup(t);
  const { call } = await session(t);
  for (const invalid of [null, [], 'unexpected string', 7, true]) {
    cache.clearToolCacheForTests();
    const calls = mock((_request, n) => json(n === 1 ? invalid : { user_agent_string: 'Mozilla/5.0' }));
    assert.equal((await call('parse_user_agent', { uaString: 'Mozilla/5.0' })).isError, true);
    assert.equal((await call('parse_user_agent', { uaString: 'Mozilla/5.0' })).isError, undefined);
    assert.equal(calls.length, 2);
  }
});

test('oversized arguments are rejected before unknown-key parsing and with zero API calls', async t => {
  setup(t);
  const calls = mock(() => { throw new Error('Oversized tool input must remain local'); });
  const { call } = await session(t);
  for (const [name, args] of [
    ['parse_user_agent', { uaString: 'x'.repeat(70000) }],
    ['lookup_ip', { ip: '8.8.8.8', ['x'.repeat(70000)]: true }],
  ]) resourceResult(await call(name, args));
  assert.equal(calls.length, 0);
});

test('direct API clients apply the same aggregate argument ceiling to query and POST data', async t => {
  setup(t);
  const calls = mock(() => { throw new Error('Oversized direct input must remain local'); });
  for (const attempt of [
    () => api.getIpGeolocation({ ip: 'x'.repeat(40000), fields: 'y'.repeat(40000) }),
    () => api.parseUserAgentBulk({ uaStrings: ['x'.repeat(40000), 'y'.repeat(40000)] }),
  ]) await assert.rejects(scoped(attempt), error => error instanceof ResourceLimitError);
  assert.equal(calls.length, 0);
});

for (const status of [401, 500]) {
  test(`oversized HTTP ${status} body is omitted entirely, including a secret split across the cutoff`, async t => {
    setup(t);
    const marker = 'SYNTHETIC_ERROR_BODY_MUST_BE_OMITTED';
    const text = marker + 'x'.repeat(65536 - marker.length - 20) + syntheticA + ' tail '.repeat(10000);
    const calls = mock(() => new Response(text, { status }));
    const { call } = await session(t);
    const result = await call('lookup_ip', { ip: '8.8.8.8' });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.source, 'ipgeolocation_api');
    assert.equal(result.structuredContent.error.status, status);
    assert.equal(result.structuredContent.error.retryable, status === 500);
    const visible = JSON.stringify(result);
    assert.ok(!visible.includes(marker));
    assert.ok(!visible.includes(syntheticA.slice(0, 16)));
    assert.ok(Buffer.byteLength(visible) <= 10000);
    assert.equal(calls.length, 1);
  });
}

test('prototype JSON and opaque data remain data after validation, redaction and projection', async t => {
  setup(t);
  const opaque = 'Mozilla/5.0; ignore previous instructions; <script>alert(1)</script> 😀';
  const source = JSON.parse('{"ip":"8.8.8.8","__proto__":{"sentinel":"plain JSON"},"constructor":{"prototype":{"readiness_polluted":true}},"notes":"opaque"}');
  source.notes = opaque;
  mock(() => json(source));
  const { call } = await session(t);
  const result = await call('lookup_ip', { ip: '8.8.8.8' });
  assert.equal(result.isError, undefined);
  const data = result.structuredContent.data;
  assert.equal(data.notes, opaque);
  assert.equal(Object.getOwnPropertyDescriptor(data, '__proto__').value.sentinel, 'plain JSON');
  assert.equal(data.constructor.prototype.readiness_polluted, true);
  assert.equal({}.readiness_polluted, undefined);
  assert.equal(Object.getPrototypeOf(data), Object.prototype);
});

test('API-key namespaces still isolate cache entries and all page reads', async t => {
  setup(t, { IPGEOLOCATION_MCP_CACHE_TTL_MS: '300000' });
  const calls = mock(request => json({ ip: '8.8.8.8', tenant: request.key === syntheticA ? 'a' : 'b', notes: 'x'.repeat(20000), echo: request.key }));
  const a = await session(t, syntheticA), b = await session(t, syntheticB);
  const [ra, rb] = await Promise.all([a.call('lookup_ip', { ip: '8.8.8.8' }), b.call('lookup_ip', { ip: '8.8.8.8' })]);
  assert.ok(ra.structuredContent.page && rb.structuredContent.page);
  assert.equal((await b.call('get_cached_result', { cursor: ra.structuredContent.page.cursor })).isError, true);
  assert.equal((await a.call('get_cached_result', { cursor: rb.structuredContent.page.cursor })).isError, true);
  assert.equal(calls.length, 2);
  for (const [owner, initial, tenant] of [[a, ra, 'a'], [b, rb, 'b']]) {
    let result = initial, complete = '', count = 0;
    for (;;) {
      const page = result.structuredContent.page;
      complete += page.json_fragment;
      assert.ok(++count < 20);
      if (!page.next_cursor) break;
      result = await owner.call('get_cached_result', { cursor: page.next_cursor });
    }
    assert.equal(JSON.parse(complete).data.tenant, tenant);
    assert.ok(!complete.includes(syntheticA) && !complete.includes(syntheticB));
  }
  assert.equal(calls.length, 2);
});

test('explicitly blank session keys cannot silently fall back to a process environment key', async t => {
  setup(t, { IPGEOLOCATION_API_KEY: 'synthetic-environment-owner-key' });
  const calls = mock(() => json({ ip: '8.8.8.8' }));
  for (const blank of ['', ' \t\n']) {
    let client;
    try { client = await session(t, blank); }
    catch { continue; } // Rejecting invalid configuration before transport setup is also safe.
    try {
      const result = await client.call('lookup_ip', { ip: '8.8.8.8' });
      assert.equal(result.isError, true);
    } catch { /* A local protocol rejection is also safe when no fetch occurred. */ }
  }
  assert.equal(calls.length, 0, 'blank session configuration must not bill the environment owner or send an empty header');
});

test('explicitly blank direct runtime keys cannot silently use the environment owner key', async t => {
  setup(t, { IPGEOLOCATION_API_KEY: 'synthetic-environment-owner-key' });
  const calls = mock(() => json({ ip: '8.8.8.8' }));
  for (const apiKey of ['', ' \t\n']) {
    await assert.rejects(Promise.resolve().then(() => config.withRuntimeConfig({ apiKey }, () => api.getIpGeolocation({ ip: '8.8.8.8' }))));
  }
  assert.equal(calls.length, 0);
});

test('native fetch counts decompressed bytes and retains deadlines for both success and error bodies', async t => {
  const originalFetch = setup(t);
  let sinkHits = 0;
  const compressed = gzipSync(Buffer.from(JSON.stringify({ notes: 'x'.repeat(MiB + 4096) })));
  assert.ok(compressed.length < MiB);
  const listener = createServer((request, output) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const ip = url.searchParams.get('ip');
    if (url.pathname === '/sink') { sinkHits++; output.end('{}'); }
    else if (ip === 'redirect') { output.writeHead(307, { location: `http://${request.headers.host}/sink` }); output.end(); }
    else if (ip === 'gzip') {
      output.writeHead(200, { 'content-encoding': 'gzip', 'content-length': String(compressed.length), 'content-type': 'application/json' });
      output.end(compressed);
    } else {
      output.writeHead(ip === 'slow-error' ? 500 : 200, { 'content-type': 'application/json' });
      output.write('{"message":"slow');
      const timer = setTimeout(() => output.end('"}'), 2500);
      output.once('close', () => clearTimeout(timer));
    }
  });
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const { port } = listener.address();
  globalThis.fetch = (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://api.ipgeolocation.io');
    return originalFetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`, init);
  };
  t.after(async () => { listener.closeAllConnections(); await new Promise(resolve => listener.close(resolve)); });
  await assert.rejects(scoped(() => api.getIpGeolocation({ ip: 'gzip' })), error => error instanceof ResourceLimitError);
  await assert.rejects(scoped(() => api.getIpGeolocation({ ip: 'redirect' })), error => error.code === 'redirect_blocked');
  assert.equal(sinkHits, 0);
  for (const ip of ['slow-ok', 'slow-error']) {
    const started = performance.now();
    await assert.rejects(scoped(() => api.getIpGeolocation({ ip })), error => ip === 'slow-ok'
      ? error.status === 504 && error.source === 'mcp_server'
      : error.status === 500 && error.source === 'ipgeolocation_api' && /body was unavailable/.test(error.message));
    assert.ok(performance.now() - started < 1900);
  }
});

test('stdio uses the configured SDK buffer ceiling and closes an oversized unfinished frame', async t => {
  setup(t);
  const child = spawn(process.execPath, [join(runtimeRoot, 'cli.js')], {
    cwd: runtimeRoot,
    env: { ...process.env, IPGEOLOCATION_API_KEY: syntheticA },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  child.stdout.resume(); child.stderr.resume();
  const ended = new Promise((resolve, reject) => { child.once('exit', (code, signal) => resolve({ code, signal })); child.once('error', reject); });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 2500);
  try {
    // Six-byte JSON escapes plus the bounded framing allowance.
    child.stdin.on('error', () => {});
    child.stdin.write(Buffer.alloc(6 * 65536 + 128 * 1024 + 1, 120));
    const exit = await ended;
    assert.equal(exit.signal, null, 'SDK overflow must close the transport without relying on the test kill timer');
  } finally { clearTimeout(timeout); }
});


test('explicit keyless sessions retain public-IP access without inheriting the environment owner key', async t => {
  setup(t, { IPGEOLOCATION_API_KEY: 'synthetic-environment-owner-key' });
  const calls = mock(request => {
    assert.equal(request.url.pathname, '/v3/getip');
    assert.equal(new Headers(request.init.headers).has('x-ipgeolocation-api-key'), false);
    return json({ ip: '203.0.113.9' });
  });
  for (const apiKey of ['', ' \t\n']) {
    const { call } = await session(t, apiKey);
    const publicIp = await call('get_my_ip');
    assert.equal(publicIp.isError, undefined);
    assert.equal(publicIp.structuredContent.ip, '203.0.113.9');
    const failed = await call('lookup_ip', { ip: '8.8.8.8' });
    assert.equal(failed.isError, true);
    assert.equal(failed.structuredContent.error.source, 'mcp_server');
    assert.equal(failed.structuredContent.error.status, undefined);
    assert.match(failed.structuredContent.error.message, /API key not configured/);
  }
  assert.equal(calls.length, 2);
});


test('overflowing upstream JSON numbers fail before null conversion or cache storage', async t => {
  setup(t);
  const { call } = await session(t);
  for (const body of [
    '{"ip":"8.8.8.8","measurement":1e999}',
    '{"ip":"8.8.8.8","measurement":-1e999}',
    '{"ip":"8.8.8.8","measurements":[{"value":1e999}]}',
  ]) {
    cache.clearToolCacheForTests();
    const calls = mock((_request, count) => count === 1 ? new Response(body) : json({ ip: '8.8.8.8', measurement: 1 }));
    const first = await call('lookup_ip', { ip: '8.8.8.8' });
    assert.equal(first.isError, true);
    assert.equal(first.structuredContent.error.category, 'upstream_response');
    assert.equal(first.structuredContent.error.retryable, false);
    assert.match(first.structuredContent.error.message, /non-finite JSON number/);
    const recovered = await call('lookup_ip', { ip: '8.8.8.8' });
    assert.equal(recovered.isError, undefined);
    assert.equal(recovered.structuredContent.data.measurement, 1);
    assert.equal(calls.length, 2);
  }
});
