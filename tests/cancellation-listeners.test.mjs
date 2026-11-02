import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = process.env.SERVER_RUNTIME_ROOT || fileURLToPath(new URL("../dist", import.meta.url));
const config = await import(pathToFileURL(join(root, 'config.js')).href);
const cache = await import(pathToFileURL(join(root, 'tools/cache.js')).href);
const scope = (signal, callback) => config.withRuntimeConfig({ apiKey: 'cancellation-listener-synthetic-key' }, () => config.withRequestSignal(signal, callback));

test('settled cache subscribers remove caller abort listeners', async t => {
  cache.clearToolCacheForTests();
  t.after(() => cache.clearToolCacheForTests());
  for (let i = 0; i < 100; i++) {
    const caller = new AbortController();
    const result = await scope(caller.signal, () => cache.getCachedOrFetchValue(`listener-${i}`, async () => ({ value: i })));
    assert.deepEqual(result, { value: i });
    assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
  }
});

test('cancelled subscribers release their listeners while live subscribers retain shared work', async t => {
  cache.clearToolCacheForTests();
  t.after(() => cache.clearToolCacheForTests());
  const gate = Promise.withResolvers();
  const controllers = Array.from({ length: 20 }, () => new AbortController());
  let calls = 0, upstreamSignal;
  const requests = controllers.map(controller => scope(controller.signal, () => cache.getCachedOrFetchValue('shared-listener-probe', () => {
    calls++;
    upstreamSignal = config.getRequestSignal();
    return gate.promise;
  })));
  const settled = Promise.allSettled(requests);
  assert.equal(calls, 1);
  for (const controller of controllers) assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
  for (const controller of controllers.slice(0, 10)) controller.abort();
  assert.equal(upstreamSignal.aborted, false);
  for (const controller of controllers.slice(0, 10)) assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  gate.resolve({ result: 'complete' });
  const results = await settled;
  assert.equal(results.filter(result => result.status === 'rejected').length, 10);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 10);
  for (const controller of controllers) assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('pre-cancelled requests start no work and attach no abort listener', async t => {
  cache.clearToolCacheForTests();
  t.after(() => cache.clearToolCacheForTests());
  const caller = new AbortController();
  caller.abort();
  let calls = 0;
  await assert.rejects(scope(caller.signal, () => cache.getCachedOrFetchValue('never-start', async () => { calls++; return {}; })), error => error.name === 'RequestCancelledError');
  assert.equal(calls, 0);
  assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
});
