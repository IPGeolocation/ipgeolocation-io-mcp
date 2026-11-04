import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const root = resolve(process.env.SERVER_RUNTIME_ROOT ?? fileURLToPath(new URL('../dist', import.meta.url)));
const runtime = name => import(pathToFileURL(`${root}/${name}.js`).href);
const [redaction, config, response, server, cache] = await Promise.all([
  runtime('redaction'), runtime('config'), runtime('tools/response'), runtime('index'), runtime('tools/cache'),
]);
const key = 'redaction-hardening-synthetic-key';
const scoped = (secret, fn) => config.withRuntimeConfig({ apiKey: secret }, fn);
const ordinary = { company: { name: 'Bearer Networks Ltd' }, user_agent_string: 'MyApp/1.0 (bearer edition) api_key=public-demo', authorization_note: 'Bearer is a company name' };
const freeze = value => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };

test('ordinary company and user-agent text survives success sanitization unchanged', () => {
  for (const secret of ['', key]) {
    const source = freeze(structuredClone(ordinary));
    assert.deepEqual(scoped(secret, () => redaction.redactSensitiveValue(source)), ordinary);
    assert.deepEqual(JSON.parse(scoped(secret, () => response.formatToolResult(source))), ordinary);
  }
  assert.equal(scoped(key, () => redaction.redactSensitiveText('Bearer standalone-token')), 'Bearer [REDACTED_TOKEN]');
});

test('explicit credential properties are masked recursively even without a configured key', () => {
  const source = freeze({ apiKey: 'public-demo', API_KEY: { nested: 'sensitive' }, 'api-key': ['sensitive'], 'x-ipgeolocation-api-key': 'header-secret', nested: [{ Authorization: 'Bearer unknown-token', authorization: 'Basic unknown-value', user_agent_string: ordinary.user_agent_string }] });
  const result = JSON.parse(scoped('', () => response.formatToolResult(source)));
  for (const field of ['apiKey', 'API_KEY', 'api-key', 'x-ipgeolocation-api-key']) assert.equal(result[field], '[REDACTED_API_KEY]');
  assert.equal(result.nested[0].Authorization, '[REDACTED_TOKEN]');
  assert.equal(result.nested[0].authorization, '[REDACTED_TOKEN]');
  assert.equal(result.nested[0].user_agent_string, ordinary.user_agent_string);
});

for (const [secret, unchanged, masked] of [
  ['ab', ['Arab Emirates', 'ab12', 'cabinet', '𐐀ab', 'ab𐐀', 'a\u0301ab'], ['ab', 'key=ab', '😀ab😀', '%20%61%62%20']],
  ['é', ['Montréal', 'Québec', 'Montr%C3%A9al'], ['é', 'key=%c3%A9', '%20%C3%A9%20']],
  ['a', ['data', 'Canada', 'a1', 'name'], ['a', 'key=a']],
  ['𐐀𐐁', ['x𐐀𐐁y'], ['𐐀𐐁', 'key=𐐀𐐁']],
]) test(`very short ${JSON.stringify(secret)} keys use Unicode-aware boundaries without rejecting configuration`, () => {
  for (const text of unchanged) assert.equal(scoped(secret, () => redaction.redactSensitiveText(text)), text);
  for (const text of masked) assert.ok(scoped(secret, () => redaction.redactSensitiveText(text)).includes('[REDACTED_API_KEY]'), text);
  assert.equal(scoped(secret, () => redaction.redactSensitiveValue({ apiKey: `prefix${secret}suffix`, authorization: `Bearer prefix${secret}suffix` })).apiKey, '[REDACTED_API_KEY]');
  assert.equal(scoped(secret, () => redaction.redactSensitiveText(`api_key=prefix${secret}suffix`)), 'api_key=[REDACTED_API_KEY]');
  assert.equal(scoped(secret, () => config.getConfiguredApiKey()), secret);
});

test('four-character and ordinary longer keys retain embedded-secret masking', () => {
  for (const secret of ['abcd', key]) assert.equal(scoped(secret, () => redaction.redactSensitiveText(`prefix${secret}suffix`)), 'prefix[REDACTED_API_KEY]suffix');
});

for (const secret of ['review-quote"key', 'review space key', 'k~SYNTH!*()\'0123', 'key.*+?^$()[]{}|\\SYNTH', 'kéSYNTH0123', 'literal%2Fsecret']) {
  test(`literal/JSON/URI/form encodings redact for unusual synthetic key ${JSON.stringify(secret)}`, () => {
    const uri = encodeURIComponent(secret), form = new URLSearchParams({ key: secret }).toString().slice(4);
    const percent = Array.from(Buffer.from(secret), byte => `%${byte.toString(16).padStart(2, '0')}`).join('');
    const fullJson = Array.from({ length: secret.length }, (_, index) => `\\u${secret.charCodeAt(index).toString(16).padStart(4, '0')}`).join('');
    const minimal = JSON.stringify(secret).slice(1, -1);
    const mixedPercent = percent.replace(/%[0-9a-f]{2}/gi, (part, index) => index % 2 ? part.toUpperCase() : part.toLowerCase());
    for (const echo of new Set([secret, minimal, JSON.stringify(minimal).slice(1, -1), minimal.replaceAll('/', '\\/'), uri, encodeURIComponent(uri), form, encodeURIComponent(form), percent, mixedPercent, encodeURIComponent(percent), encodeURIComponent(percent.toUpperCase()), fullJson, fullJson.replace(/[a-f]/g, char => char.toUpperCase())])) {
      const error = scoped(secret, () => redaction.redactSensitiveText(`echo=${echo}`));
      assert.equal(error, 'echo=[REDACTED_API_KEY]', echo);
      const source = freeze(Object.fromEntries([[echo, [echo]]]));
      assert.deepEqual(JSON.parse(scoped(secret, () => response.formatToolResult(source))), { '[REDACTED_API_KEY]': ['[REDACTED_API_KEY]'] });
    }
  });
}

test('redaction markers remain stable when a configured key overlaps their text', () => {
  for (const secret of ['API_KEY', 'REDACTED', 'KEY', key]) {
    const first = scoped(secret, () => redaction.redactSensitiveText(`secret=${secret}`));
    assert.equal(first, 'secret=[REDACTED_API_KEY]');
    assert.equal(scoped(secret, () => redaction.redactSensitiveText(first)), first);
    const data = scoped(secret, () => response.formatToolResult({ echo: secret, apiKey: secret }));
    assert.equal(scoped(secret, () => response.formatToolResult(JSON.parse(data))), data);
  }
});

test('literal percent spelling remains case-sensitive outside generated URI representations', () => {
  const secret = 'literal%2Fsecret';
  const unrelated = 'literal%2fsecret';
  for (const value of [unrelated, encodeURIComponent(unrelated), encodeURIComponent(encodeURIComponent(unrelated))]) {
    assert.equal(scoped(secret, () => redaction.redactSensitiveValue(value)), value);
  }
});

test('encoded-key diagnostic replacement is equivalent on delimiters and linear for a near-8MiB suffix', { timeout: 10000 }, () => {
  const previous = /((?:apiKey|apikey|api_key|api-key)%3D)(?:%[0-9A-Fa-f]{2}|[^&#\s"'])+/gi;
  for (const prefix of ['apiKey%3D', 'api_key%3d', 'api-key%3D']) {
    for (let char = 0; char < 128; char++) {
      const value = prefix + String.fromCharCode(char) + 'abc%2f%ZZ' + String.fromCharCode(char);
      assert.equal(scoped(key, () => redaction.redactSensitiveText(value)), value.replace(previous, '$1[REDACTED_API_KEY]'));
    }
  }
  const large = 'apiKey%3D' + 'a'.repeat(8_388_580);
  assert.equal(scoped(key, () => redaction.redactSensitiveText(large)), 'apiKey%3D[REDACTED_API_KEY]');
});

async function session(t, secret, payload) {
  const nativeFetch = globalThis.fetch;
  cache.clearToolCacheForTests();
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).origin, 'https://api.ipgeolocation.io');
    assert.equal(new Headers(options.headers).get('x-ipgeolocation-api-key'), secret);
    calls++;
    return new Response(JSON.stringify(payload));
  };
  const instance = server.createMcpServer({ apiKey: secret });
  const client = new Client({ name: 'redaction-hardening', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([instance.connect(a), client.connect(b)]);
  t.after(async () => { await client.close(); await instance.close(); globalThis.fetch = nativeFetch; cache.clearToolCacheForTests(); });
  return { client, count: () => calls };
}

async function recover(client, first) {
  let result = first, text = '', pages = 0;
  if (!result.structuredContent.page) return result.structuredContent;
  while (result.structuredContent.page) {
    const page = result.structuredContent.page;
    assert.equal(page.offset, text.length);
    text += page.json_fragment;
    assert.ok(++pages < 250);
    if (!page.next_cursor) return JSON.parse(text);
    result = await client.callTool({ name: 'get_cached_result', arguments: { cursor: page.next_cursor } });
    assert.equal(result.isError, undefined);
  }
  assert.fail('Missing final page');
}

test('actual success and warm-cache paths preserve harmless text and raw cached data', async t => {
  const payload = { ...ordinary, note: key }, original = JSON.stringify(payload);
  const { client, count } = await session(t, key, payload);
  for (let i = 0; i < 2; i++) {
    const result = await client.callTool({ name: 'lookup_ip', arguments: { ip: '8.8.8.8' } });
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent.data, { ...ordinary, note: '[REDACTED_API_KEY]' });
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent.data);
  }
  assert.equal(count(), 1);
  assert.equal(JSON.stringify(payload), original);
});

test('bulk item diagnostics stay masked without rewriting harmless original input labels or successful data', async t => {
  const input = ordinary.user_agent_string;
  const { client, count } = await session(t, key, [{ ...ordinary }, { message: 'Invalid api_key=unknown-sensitive-value', status: 400 }]);
  const result = await client.callTool({ name: 'bulk_parse_user_agent', arguments: { uaStrings: ['Other Browser', input] } });
  assert.deepEqual(result.structuredContent.items[0], ordinary);
  assert.equal(result.structuredContent.errors[0].input, input);
  assert.equal(result.structuredContent.errors[0].message, 'Invalid api_key=[REDACTED_API_KEY]');
  assert.equal(result.structuredContent.items[1].message, 'Invalid api_key=[REDACTED_API_KEY]');
  assert.ok(!JSON.stringify(result).includes('unknown-sensitive-value'));
  assert.equal(count(), 1);
});

test('near-8MiB successful encoded-looking data remains paginated and cached instead of a repeatable redaction failure', { timeout: 30000 }, async t => {
  const payload = { note: 'apiKey%3D' + 'a'.repeat(8_388_580) };
  assert.ok(Buffer.byteLength(JSON.stringify(payload)) <= 8 * 1024 * 1024);
  const { client, count } = await session(t, key, payload);
  for (let i = 0; i < 2; i++) {
    const first = await client.callTool({ name: 'lookup_ip', arguments: { ip: '8.8.8.8' } }, undefined, { timeout: 30000 });
    assert.equal(first.isError, undefined);
    assert.ok(first.structuredContent.page);
    const recovered = await recover(client, first);
    assert.deepEqual(recovered.data, payload);
  }
  assert.equal(count(), 1);
});

test('follow-up: a skipped short-secret match cannot hide a later overlapping token', () => {
  const secret = '1.1';
  for (const text of ['v1.1.1', 'v\\u0031.1.1', 'v1.\\u0031.1']) {
    const result = scoped(secret, () => redaction.redactKnownSecrets(text));
    assert.match(result, /\[REDACTED_API_KEY\]$/);
    assert.equal(scoped(secret, () => redaction.redactKnownSecrets(result)), result);
  }
  assert.equal(scoped(secret, () => redaction.redactKnownSecrets('v1.1.1')), 'v1.[REDACTED_API_KEY]');
  assert.equal(scoped(secret, () => redaction.redactKnownSecrets('v1.1x')), 'v1.1x');
});

test('follow-up: mixed JSON escapes and encodeURI representations mask the complete configured key', () => {
  for (const secret of ['kéy/Synth-0042', 'quoted"/synthetic\\key-19', 'unicode漢😀/synthetic-53', 'literal\\u0041/secret-07']) {
    const echoes = [encodeURI(secret), encodeURIComponent(encodeURI(secret))];
    for (let variation = 0; variation < 16; variation++) {
      let text = '';
      for (let i = 0; i < secret.length; i++) {
        const char = secret[i], escaped = `\\u${secret.charCodeAt(i).toString(16).padStart(4, '0')}`;
        text += ((i * 7 + variation) % 5 < 2) ? escaped : char === '/' && variation % 2 ? '\\/' : JSON.stringify(char).slice(1, -1);
      }
      echoes.push(text);
    }
    for (const echo of echoes) {
      assert.equal(scoped(secret, () => redaction.redactSensitiveText(`echo=${echo}`)), 'echo=[REDACTED_API_KEY]', echo);
      assert.deepEqual(scoped(secret, () => redaction.redactSensitiveValue({ [echo]: [echo] })), { '[REDACTED_API_KEY]': ['[REDACTED_API_KEY]'] });
    }
  }
});

test('follow-up: known-key matching preserves case-sensitive unrelated text and malformed escape data', () => {
  const secret = 'kéy/Synth-0042';
  for (const text of [secret.toUpperCase(), 'k\\u00E9y/SYNTH-0042', 'k\\u00zy/Synth-0042', 'k\\U00e9y/Synth-0042']) {
    assert.equal(scoped(secret, () => redaction.redactSensitiveValue(text)), text);
  }
  assert.equal(scoped(secret, () => redaction.redactSensitiveText(`api_key=${secret.toUpperCase()}`)), 'api_key=[REDACTED_API_KEY]');
});

test('follow-up: long shared prefixes in JSON escapes finish without recursive matching or whole-response offset maps', { timeout: 10000 }, () => {
  const secret = 'a'.repeat(128) + 'b';
  const prefix = '\\u0061'.repeat(200000);
  assert.equal(scoped(secret, () => redaction.redactKnownSecrets(prefix)), prefix);
  assert.equal(scoped(secret, () => redaction.redactKnownSecrets(prefix + '\\u0062')), '\\u0061'.repeat(200000 - 128) + '[REDACTED_API_KEY]');
});

test('follow-up: exact numeric echoes mask longer keys without rewriting short-key counters or numeric formats', () => {
  for (const secret of ['123456', '-12345', '123.45']) {
    const value = Number(secret);
    assert.deepEqual(scoped(secret, () => redaction.redactSensitiveValue({ echo: value, other: 17 })), { echo: '[REDACTED_API_KEY]', other: 17 });
  }
  for (const secret of ['1', '12', '1.1']) {
    const value = Number(secret);
    assert.deepEqual(scoped(secret, () => redaction.redactSensitiveValue({ count: value, api_key: value })), { count: value, api_key: '[REDACTED_API_KEY]' });
  }
  assert.equal(scoped('001234', () => redaction.redactSensitiveValue(1234)), 1234);
  assert.equal(scoped('1e3', () => redaction.redactSensitiveValue(1000)), 1000);
});

for (const [secret, echo] of [
  ['key/Synth-0042', String.raw`k\u0065y\/Synth-0042`],
  ['1.1', 'v1.1.1'],
  ['123456', 123456],
]) test(`follow-up: real MCP inline and paged results mask ${JSON.stringify(secret)} echoes`, async t => {
  const payload = { ...ordinary, echo, filler: 'safe content '.repeat(20000) };
  const { client, count } = await session(t, secret, payload);
  const result = await client.callTool({ name: 'lookup_ip', arguments: { ip: '8.8.8.8' } });
  assert.equal(result.isError, undefined);
  const recovered = await recover(client, result);
  assert.equal(recovered.data.echo, secret === '1.1' ? 'v1.[REDACTED_API_KEY]' : '[REDACTED_API_KEY]');
  assert.deepEqual(recovered.data.company, ordinary.company);
  assert.equal(recovered.data.user_agent_string, ordinary.user_agent_string);
  assert.equal(count(), 1);
});

test('short values and percent-free text avoid unnecessary percent normalization', t => {
  const replace = String.prototype.replace;
  let unnecessaryPasses = 0;
  t.mock.method(String.prototype, 'replace', function (pattern, ...args) {
    if (pattern instanceof RegExp && pattern.source.startsWith('%') && !String(this).includes('%')) unnecessaryPasses++;
    return Reflect.apply(replace, this, [pattern, ...args]);
  });
  const values = Array.from({ length: 10000 }, (_, index) => index % 2 ? 'short' : 'Ordinary company and location names without encoded characters.');
  assert.deepEqual(scoped(key, () => redaction.redactSensitiveValue(values)), values);
  assert.equal(unnecessaryPasses, 0);
  assert.equal(scoped(key, () => redaction.redactKnownSecrets(key)), '[REDACTED_API_KEY]');
  const encoded = Array.from(Buffer.from(key), byte => `%${byte.toString(16).padStart(2, '0')}`).join('');
  assert.equal(scoped(key, () => redaction.redactKnownSecrets(encoded)), '[REDACTED_API_KEY]');
});

test('rejected backslash credentials remain masked in literal and encoded diagnostics', () => {
  for (const secret of [String.raw`ab\ncd1234`, String.raw`ab\tcd1234`, String.raw`ab\"cd1234`, String.raw`ab\u0061cd1234`, String.raw`ab\\cd1234`]) {
    const escaped = JSON.stringify(secret).slice(1, -1);
    for (const echo of [secret, escaped, JSON.stringify(escaped).slice(1, -1)]) {
      assert.equal(scoped(secret, () => redaction.redactKnownSecrets(echo)), '[REDACTED_API_KEY]');
      const data = scoped(secret, () => response.formatToolResult({ note: echo, apiKey: echo }));
      assert.deepEqual(JSON.parse(data), { note: '[REDACTED_API_KEY]', apiKey: '[REDACTED_API_KEY]' });
      assert.ok(!data.includes(secret));
    }
  }
});

test('short-key neighbours skip JSON parsing for invalid escape syntax', t => {
  let parseCalls = 0;
  const parse = JSON.parse;
  t.mock.method(JSON, 'parse', (...args) => { parseCalls++; return parse(...args); });
  for (const prefix of [String.raw`\q`, String.raw`\U0061`, String.raw`\u00G1`, String.raw`\x20`]) {
    const text = `${prefix}ab1`.repeat(20000);
    assert.equal(scoped('ab1', () => redaction.redactKnownSecrets(text)), text);
  }
  assert.equal(parseCalls, 0, 'invalid escape neighbours must not use exceptions for matching');
});

test('short-key boundaries recognize a complete JSON-escaped Unicode letter or emoji', () => {
  for (const letter of [String.raw`\uD801\uDC00`, String.raw`\ud801\udc00`]) {
    for (const text of [`${letter}ab`, `ab${letter}`]) {
      assert.equal(scoped('ab', () => redaction.redactKnownSecrets(text)), text);
    }
  }
  const emoji = String.raw`\uD83D\uDE00`;
  assert.equal(scoped('ab', () => redaction.redactKnownSecrets(`${emoji}ab${emoji}`)), `${emoji}[REDACTED_API_KEY]${emoji}`);
  for (const whitespace of [String.raw`\n`, String.raw`\t`, String.raw`\u0020`]) {
    assert.equal(scoped('ab', () => redaction.redactKnownSecrets(`${whitespace}ab${whitespace}`)), `${whitespace}[REDACTED_API_KEY]${whitespace}`);
  }
});

test('invalid percent-encoded neighbours do not throw decoding exceptions for each short-key match', t => {
  const decode = globalThis.decodeURIComponent;
  let decodingErrors = 0;
  t.mock.method(globalThis, 'decodeURIComponent', (...args) => {
    try { return decode(...args); } catch (error) { decodingErrors++; throw error; }
  });
  const invalid = '%ff%ff%ff%ff';
  const before = `${invalid}ab1 `.repeat(10000);
  const after = ` ab1${invalid}`.repeat(10000);
  assert.equal(scoped('ab1', () => redaction.redactKnownSecrets(before)), before);
  assert.equal(scoped('ab1', () => redaction.redactKnownSecrets(after)), ` [REDACTED_API_KEY]${invalid}`.repeat(10000));
  assert.equal(decodingErrors, 0, 'invalid UTF-8 must not use exceptions to find a token boundary');
});

test('percent-encoded short-key neighbours preserve Unicode boundaries and malformed bytes', () => {
  const marker = '[REDACTED_API_KEY]';
  const cases = [
    ...['A', '7', '_', 'é', '漢', '𐐀', '\u0301', '١'].map(value => [value, false]),
    ...[' ', '\t', '\0', '\u00a0', '/', '😀', '\u{10ffff}'].map(value => [value, true]),
  ];
  for (const echo of ['ab1', String.raw`\u0061b1`, '%61%62%31']) {
    for (const [value, masks] of cases) {
      const encoded = Array.from(Buffer.from(value), byte => `%${byte.toString(16).padStart(2, '0')}`).join('');
      for (const neighbour of new Set([encoded, encoded.toUpperCase()])) {
        for (const [text, expected] of [
          [`${neighbour}${echo} `, `${neighbour}${masks ? marker : echo} `],
          [` ${echo}${neighbour}`, ` ${masks ? marker : echo}${neighbour}`],
        ]) {
          assert.equal(scoped('ab1', () => redaction.redactKnownSecrets(text)), expected, text);
        }
      }
    }
    // Invalid UTF-8 keeps the previous raw-character fallback. A trailing hex
    // character is part of a word, while a leading percent sign is a boundary.
    for (const neighbour of ['%80', '%BF', '%C0%AF', '%C1%BF', '%E0%80%AF', '%ED%A0%80', '%ED%BF%BF', '%F0%80%80%AF', '%F4%90%80%80', '%F5%80%80%80', '%FF', '%C2', '%E2%82', '%F0%9F%98', '%GG']) {
      for (const spelling of new Set([neighbour, neighbour.toLowerCase()])) {
        const before = `${spelling}${echo} `;
        assert.equal(scoped('ab1', () => redaction.redactKnownSecrets(before)), before, before);
        assert.equal(scoped('ab1', () => redaction.redactKnownSecrets(` ${echo}${spelling}`)), ` ${marker}${spelling}`);
      }
    }
  }
});

test('encoded-looking company text remains data with short and ordinary API keys', () => {
  const payload = { ...ordinary, company: { name: 'Arab Networks Ltd', domain: 'company.example', type: 'isp' }, authorization_note: 'Bearer Networks is the company name', note: '%ff%ff%ff%ffab1 another%80value', names: ['Montr%C3%A9al', '%F0%90%90%80ab1'] };
  for (const secret of ['ab1', 'a', '0123456789abcdef0123456789abcdef']) {
    assert.deepEqual(scoped(secret, () => redaction.redactSensitiveValue(payload)), payload);
    assert.equal(scoped(secret, () => redaction.redactKnownSecrets(` %ff${secret}%ff `)), secret.length < 4 ? ` %ff${secret}%ff ` : ' %ff[REDACTED_API_KEY]%ff ');
  }
});

test('invalid percent-encoded data survives cold, warm and cached-page MCP results', async t => {
  const payload = { ...ordinary, note: '%ff%ff%ff%ffab1 '.repeat(20000) };
  const { client, count } = await session(t, 'ab1', payload);
  for (let i = 0; i < 2; i++) {
    const first = await client.callTool({ name: 'lookup_ip', arguments: { ip: '8.8.8.8' } });
    assert.equal(first.isError, undefined);
    assert.ok(first.structuredContent.page);
    assert.deepEqual((await recover(client, first)).data, payload);
  }
  assert.equal(count(), 1);
});

test('short-key boundaries recognize double-encoded Unicode neighbours', () => {
  const percent = value => Array.from(Buffer.from(value), byte => `%${byte.toString(16).padStart(2, '0')}`).join('');
  const marker = '[REDACTED_API_KEY]';
  const neighbours = [
    ...['A', '7', '_', 'é', '漢', '𐐀', '\u0301', '١'].map(value => [value, false]),
    ...[' ', '\t', '\0', '\u00a0', '/', '😀', '\u{10ffff}'].map(value => [value, true]),
  ];
  for (const secret of ['a', 'ab', 'ab1', 'é', '漢', '🚀', '𐐀𐐁', 'aé1', 'a b', 'a/b', "a'", '%2F']) {
    const json = Array.from({ length: secret.length }, (_, index) => index % 2 ? secret[index] : `\\u${secret.charCodeAt(index).toString(16).padStart(4, '0')}`).join('');
    const form = new URLSearchParams({ key: secret }).toString().slice(4);
    const echoes = new Set([secret, json, encodeURI(secret), encodeURIComponent(secret), form, percent(secret), ...[encodeURI(secret), encodeURIComponent(secret), form, percent(secret)].map(encodeURIComponent)]);
    for (const echo of echoes) {
      for (const [value, masks] of neighbours) {
        const encoded = encodeURIComponent(percent(value));
        for (const neighbour of new Set([encoded, encoded.toLowerCase()])) {
          const replacement = masks ? marker : echo;
          for (const [text, expected] of [
            [`${neighbour}${echo} `, `${neighbour}${replacement} `],
            [` ${echo}${neighbour}`, ` ${replacement}${neighbour}`],
            [`${neighbour}${echo}${neighbour}`, `${neighbour}${replacement}${neighbour}`],
          ]) {
            assert.equal(scoped(secret, () => redaction.redactKnownSecrets(text)), expected, text);
            assert.equal(scoped(secret, () => redaction.redactSensitiveText(text)), expected, text);
            assert.equal(scoped(secret, () => redaction.redactSensitiveValue(text)), expected, text);
          }
        }
      }
    }
  }
});

test('double-encoded short-key boundaries preserve malformed bytes and literal percent data', () => {
  const marker = '[REDACTED_API_KEY]';
  for (const neighbour of ['%2580', '%25BF', '%25C0%25AF', '%25ED%25A0%2580', '%25F4%2590%2580%2580', '%25C2', '%25E2%2582', '%25F0%259F%2598', '%25GG', '%2G20', '%252']) {
    for (const echo of ['ab1', '%61%62%31', '%2561%2562%2531']) {
      assert.equal(scoped('ab1', () => redaction.redactKnownSecrets(`${neighbour}${echo} `)), `${neighbour}${echo} `);
      assert.equal(scoped('ab1', () => redaction.redactKnownSecrets(` ${echo}${neighbour}`)), ` ${marker}${neighbour}`);
    }
  }
  for (const text of ['%2561ab1', 'ab1%2561', '%25C3%25A9ab1', 'ab1%25F0%2590%2590%2580']) {
    assert.equal(scoped('ab1', () => redaction.redactKnownSecrets(text)), text);
  }
  for (const secret of ['abcd', key]) {
    assert.equal(scoped(secret, () => redaction.redactKnownSecrets(`%2561${secret}%2561`)), `%2561${marker}%2561`);
  }
});

test('double-encoded short-key echoes stay masked in cold, warm and cached-page MCP results', async t => {
  const echo = '%2520%2561%2562%2531%2520';
  const payload = { ...ordinary, note: echo, filler: 'ordinary content '.repeat(20000) };
  const { client, count } = await session(t, 'ab1', payload);
  for (let i = 0; i < 2; i++) {
    const first = await client.callTool({ name: 'lookup_ip', arguments: { ip: '8.8.8.8' } });
    assert.equal(first.isError, undefined);
    assert.ok(first.structuredContent.page);
    const recovered = await recover(client, first);
    assert.equal(recovered.data.note, '%2520[REDACTED_API_KEY]%2520');
    assert.deepEqual({ ...recovered.data, note: payload.note }, payload);
  }
  assert.equal(count(), 1);
});

test('keyless tool diagnostics mask a configured short key without changing keyless startup', async t => {
  const { client } = await session(t, 'ab1', {});
  const echo = '%2520%2561%2562%2531%2520';
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).href, 'https://api.ipgeolocation.io/v3/getip');
    assert.equal(new Headers(options.headers).has('x-ipgeolocation-api-key'), false);
    if (++calls === 1) throw new Error(`Local synthetic failure ${echo}`);
    return new Response(JSON.stringify({ ip: '8.8.8.8' }));
  };
  const failed = await client.callTool({ name: 'get_my_ip', arguments: {} });
  assert.equal(failed.isError, true);
  assert.equal(failed.structuredContent.error.category, 'upstream_request');
  assert.ok(failed.structuredContent.error.message.includes('%2520[REDACTED_API_KEY]%2520'));
  assert.ok(!JSON.stringify(failed).includes(echo));
  const success = await client.callTool({ name: 'get_my_ip', arguments: {} });
  assert.equal(success.isError, undefined);
  assert.equal(success.structuredContent.ip, '8.8.8.8');
  assert.equal(calls, 2);
});

test('short keys do not match the middle of percent or JSON escapes', () => {
  for (const [secret, values] of [
    ['A9', ['caf%C3%A9', 'caf%25C3%25A9']],
    ['20', ['a%20%20b', 'a%2520%2520b', '%20', '%2520']],
    ['25', ['%25', '%2520', '%2525']],
    ['2', ['%20', '%2520']],
    ['n', [String.raw`\n`]],
    ['f', [String.raw`\f`]],
    ['%', ['%20', '%2520']],
    ['\\', [String.raw`\n`, String.raw`\u0061`, String.raw`\uD801\uDC00`]],
  ]) {
    for (const text of values) {
      for (const redact of [redaction.redactKnownSecrets, redaction.redactSensitiveText, redaction.redactSensitiveValue]) {
        assert.equal(scoped(secret, () => redact(text)), text, `${JSON.stringify(secret)} in ${JSON.stringify(text)}`);
      }
    }
  }
});

test('short-key backslash boundaries stay bounded for a large escaped run', { timeout: 10000 }, () => {
  const count = 100000;
  const text = '\\'.repeat(count * 2);
  assert.equal(scoped('\\', () => redaction.redactKnownSecrets(text)), '[REDACTED_API_KEY]'.repeat(count));
  assert.equal(scoped('ab1', () => redaction.redactKnownSecrets(`${text}nab1`)), `${text}nab1`);
});

for (const [secret, note] of [['A9', 'caf%C3%A9'], ['20', 'a%20%20b'], ['ab1', String.raw`C:\\nab1`]]) {
  test(`short-key escape text survives cold, warm and cached-page results for ${secret}`, async t => {
    const payload = { ...ordinary, note, echo: ` ${secret} `, filler: 'ordinary content '.repeat(20000) };
    const { client, count } = await session(t, secret, payload);
    for (let i = 0; i < 2; i++) {
      const result = await client.callTool({ name: 'lookup_ip', arguments: { ip: '8.8.8.8' } });
      assert.equal(result.isError, undefined);
      assert.ok(result.structuredContent.page);
      const recovered = await recover(client, result);
      assert.deepEqual(recovered.data, { ...payload, echo: ' [REDACTED_API_KEY] ' });
    }
    assert.equal(count(), 1);
  });
}

test('short-key JSON neighbours distinguish escaped backslashes from active escapes', () => {
  for (const count of [1, 2, 3, 4, 31, 32]) {
    const slashes = '\\'.repeat(count);
    for (const suffix of ['n', 't', 'u0020']) {
      const text = `C:${slashes}${suffix}ab1`;
      const expected = count % 2 ? `C:${slashes}${suffix}[REDACTED_API_KEY]` : text;
      assert.equal(scoped('ab1', () => redaction.redactKnownSecrets(text)), expected, text);
    }
    const text = `ab1${slashes}u0061`;
    const expected = count === 1 ? text : `[REDACTED_API_KEY]${slashes}u0061`;
    assert.equal(scoped('ab1', () => redaction.redactKnownSecrets(text)), expected, text);
  }
});

test('complete short-key escapes remain masked without changing adjacent encoded text', () => {
  for (const secret of ['n', '20', 'A9', '\\', '"', '/', 'é', '😀']) {
    const percent = Array.from(Buffer.from(secret), byte => `%${byte.toString(16).padStart(2, '0')}`).join('');
    const json = JSON.stringify(secret).slice(1, -1);
    for (const echo of new Set([secret, json, percent, encodeURIComponent(percent)])) {
      for (const neighbour of [' ', '%20', '%2520', String.raw`\n`]) {
        if (echo === '\\' && neighbour === String.raw`\n`) continue;
        const text = `${neighbour}${echo}${neighbour}`;
        assert.equal(scoped(secret, () => redaction.redactKnownSecrets(text)), `${neighbour}[REDACTED_API_KEY]${neighbour}`, text);
      }
    }
  }
});
