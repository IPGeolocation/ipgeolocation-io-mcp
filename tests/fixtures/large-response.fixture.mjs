import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';

const runtimeRoot = resolve(process.env.SERVER_RUNTIME_ROOT ?? fileURLToPath(new URL('../../dist', import.meta.url)));
const {createMcpServer} = await import(pathToFileURL(`${runtimeRoot}/index.js`).href);
const cached = process.argv.includes('--cached-empty-arrays');
let payload;
if (cached) {
  payload = {ip: '8.8.8.8', rows: Array.from({length: 2_000_000}, () => [])};
} else {
  let nested = Array(4_000_000).fill(0);
  for (let i = 0; i < 60; i++) nested = [nested];
  payload = {nested};
}
const body = JSON.stringify(payload);
payload = undefined;
assert.ok(Buffer.byteLength(body) < 8 * 1024 * 1024);
const hash = text => createHash('sha256').update(text).digest('hex');
const expected = hash(body);
let upstreamRequests = 0;
globalThis.fetch = async input => {
  assert.equal(new URL(input).origin, 'https://api.ipgeolocation.io');
  upstreamRequests++;
  return new Response(body);
};
const server = createMcpServer({apiKey: 'large-response-regression-synthetic-key'});
const client = new Client({name: 'large-response-regression', version: '1'});
const [a, b] = InMemoryTransport.createLinkedPair();
try {
  await server.connect(b);
  await client.connect(a);
  await client.listTools();
  let result = await client.callTool(cached
    ? {name: 'lookup_ip', arguments: {ip: '8.8.8.8'}}
    : {name: 'get_timezone', arguments: {tz: 'UTC'}});
  let text = '', pages = 0;
  while (true) {
    assert.equal(result.isError, undefined);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 200000);
    const page = result.structuredContent.page;
    assert.equal(page.offset, text.length);
    text += page.json_fragment;
    pages++;
    assert.ok(pages < 2000);
    if (!page.next_cursor) break;
    result = await client.callTool({name: 'get_cached_result', arguments: {cursor: page.next_cursor}});
  }
  assert.ok(text.startsWith('{"data":') && text.endsWith('}'));
  assert.equal(hash(text.slice('{"data":'.length, -1)), expected);
  assert.equal(upstreamRequests, 1);
  assert.ok(pages > 1);
  console.log(JSON.stringify({inputBytes: Buffer.byteLength(body), pages, upstreamRequests, complete: true}));
} finally {
  await client.close();
  await server.close();
}
