import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const guard = fileURLToPath(new URL('./fixtures/loopback-only.cjs', import.meta.url));

test('offline guard rejects external fetch, TCP, TLS and DNS before their implementations run', () => {
  // Stubs make the negative checks safe even if the guard regresses.
  const script = `
    const assert = require('node:assert/strict');
    const net = require('node:net'), tls = require('node:tls'), dns = require('node:dns'), dgram = require('node:dgram');
    let calls = 0;
    const hit = () => { calls++; return 'local fixture'; };
    net.Socket.prototype.connect = hit; tls.connect = hit;
    dns.lookup = hit; dns.resolve4 = hit; dns.promises.resolve4 = hit;
    dgram.Socket.prototype.connect = hit; dgram.Socket.prototype.send = hit;
    globalThis.fetch = async () => { calls++; return new Response('fixture'); };
    require(${JSON.stringify(guard)});
    const denied = fn => assert.throws(fn, { code: 'ERR_TEST_NETWORK_BLOCKED' });
    for (const host of ['api.example.invalid', '192.0.2.1', '::ffff:192.0.2.1', 'localhost.evil.invalid', '127.999.0.1', '']) {
      denied(() => new net.Socket().connect({ port: 443, host }));
      denied(() => new net.Socket().connect(443, host));
      denied(() => tls.connect({ port: 443, host }));
      denied(() => dns.lookup(host));
      denied(() => dns.resolve4(host));
      denied(() => dns.promises.resolve4(host));
    }
    assert.equal(calls, 0);
    denied(() => dgram.Socket.prototype.send.call({}, Buffer.from('fixture'), 53, '192.0.2.1'));
    denied(() => dgram.Socket.prototype.connect.call({}, 53, '192.0.2.1'));
    (async () => {
      for (const input of ['https://api.example.invalid/', new URL('http://192.0.2.1/'), new Request('https://api.example.invalid/')]) {
        await assert.rejects(fetch(input), { code: 'ERR_TEST_NETWORK_BLOCKED' });
      }
      assert.equal(calls, 0);
      for (const host of ['127.0.0.1', '127.0.0.2', '::1', '0:0:0:0:0:0:0:1', 'localhost']) {
        assert.equal(new net.Socket().connect({ port: 1, host }), 'local fixture');
        assert.equal(tls.connect({ port: 1, host }), 'local fixture');
      }
      assert.equal(await (await fetch('http://127.0.0.1:1')).text(), 'fixture');
      assert.equal(calls, 11);
      assert.deepEqual(await dns.promises.lookup('localhost', { all: true }), [{ address: '127.0.0.1', family: 4 }]);
      assert.deepEqual(await dns.promises.lookup('localhost', { family: 6 }), { address: '::1', family: 6 });
      await new Promise(resolve => dns.lookup('localhost', (error, address) => { assert.ifError(error); assert.equal(address, '127.0.0.1'); resolve(); }));
      denied(() => dns.resolve4('localhost'));
      denied(() => new dns.Resolver().resolve4('localhost'));
      denied(() => new dns.promises.Resolver().resolve4('localhost'));
      assert.equal(calls, 11);
      const options = { port: 1, host: 'localhost', lookup: (_host, _options, callback) => callback(null, '192.0.2.1', 4) };
      new net.Socket().connect(options);
      denied(() => options.lookup('localhost', {}, () => {}));
      Object.defineProperty(process, 'platform', { value: 'win32' });
      for (const path of ['//remote/pipe/fixture', ${JSON.stringify('\\\\remote\\pipe\\fixture')}]) {
        denied(() => new net.Socket().connect(path));
        denied(() => new net.Socket().connect({ path }));
      }
      assert.equal(new net.Socket().connect(${JSON.stringify('\\\\.\\pipe\\fixture')}), 'local fixture');
      assert.equal(new net.Socket().connect({ path: ${JSON.stringify('\\\\.\\pipe\\fixture')} }), 'local fixture');
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  execFileSync(process.execPath, ['-e', script], {
    env: { ...process.env, NODE_OPTIONS: '', IPGEO_QA_NETWORK_BLOCK_LOG: '' }, encoding: 'utf8', timeout: 10000,
  });
});

test('offline guard propagates to child processes without discarding other Node options', t => {
  const directory = mkdtempSync(join(tmpdir(), 'mcp offline guard '));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const stub = join(directory, 'network-stub.cjs');
  writeFileSync(stub, "require('node:tls').connect = () => { throw new Error('Network implementation reached'); };\n");
  const stubOption = `--require=${JSON.stringify(stub.replaceAll('\\', '/'))}`;
  const script = `
    const assert = require('node:assert/strict');
    require(${JSON.stringify(guard)});
    assert.match(process.env.NODE_OPTIONS, /--no-warnings/);
    const child = require('node:child_process').execFileSync(process.execPath, ['-e',
      "require('node:assert/strict').throws(() => require('node:tls').connect({host:'api.example.invalid', port:443}), {code:'ERR_TEST_NETWORK_BLOCKED'})"
    ], { env: { ...process.env, NODE_OPTIONS: ${JSON.stringify(stubOption)} + ' ' + process.env.NODE_OPTIONS }, encoding: 'utf8', timeout: 5000 });
    assert.equal(child, '');
  `;
  execFileSync(process.execPath, ['-e', script], {
    env: { ...process.env, NODE_OPTIONS: '--no-warnings', IPGEO_QA_NETWORK_BLOCK_LOG: '' }, encoding: 'utf8', timeout: 10000,
  });
});

test('offline guard still permits a real loopback HTTP fixture', async t => {
  const server = createServer((_request, response) => response.end('local fixture'));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  assert.equal(await (await fetch(`http://127.0.0.1:${server.address().port}/`)).text(), 'local fixture');
});
