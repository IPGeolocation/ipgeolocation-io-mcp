import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
const runtimeRoot = resolve(process.env.SERVER_RUNTIME_ROOT ?? fileURLToPath(new URL('../dist', import.meta.url)));
const { applyFieldsAndExcludes } = await import(pathToFileURL(join(runtimeRoot, 'tools/projection.js')).href);

function measuredProjection(source, options) {
  const originals = { filter: Array.prototype.filter, map: Array.prototype.map, some: Array.prototype.some,
    get: Map.prototype.get, own: Object.prototype.hasOwnProperty, split: String.prototype.split };
  let operations = 0;
  try {
    for (const name of ['filter', 'map', 'some']) {
      Array.prototype[name] = function (callback, thisArg) {
        return originals[name].call(this, function (...args) { operations++; return callback.apply(this, args); }, thisArg);
      };
    }
    Map.prototype.get = function (key) { operations++; return originals.get.call(this, key); };
    Object.prototype.hasOwnProperty = function (key) { operations++; return originals.own.call(this, key); };
    String.prototype.split = function (...args) { const result = originals.split.apply(this, args); operations += result.length; return result; };
    return { result: applyFieldsAndExcludes(source, options), operations };
  } finally {
    for (const name of ['filter', 'map', 'some']) Array.prototype[name] = originals[name];
    Map.prototype.get = originals.get;
    Object.prototype.hasOwnProperty = originals.own;
    String.prototype.split = originals.split;
  }
}

for (const selector of ['fields', 'excludes']) {
  test(`${selector} preparation stops after an unmatched prefix in a long dotted path`, () => {
    const source = { asn: { '': { known: 1 } } };
    const { result, operations } = measuredProjection(source, { [selector]: 'asn.' + '.'.repeat(100000), rootKey: 'asn' });
    assert.deepEqual(result, selector === 'fields' ? {} : source);
    assert.ok(operations < 1000, `${operations} operations expanded an unmatchable dotted path`);
  });
}

for (const duplicate of [false, true]) {
  test('field projection has bounded work for ' + (duplicate ? 'duplicate route selectors' : 'distinct wide selectors'), () => {
    const count = 800;
    const source = duplicate ? { asn: { routes: Array.from({ length: count }, (_, i) => ({ route: `192.0.${i % 255}.0/24`, organization: 'Example', registry: 'TEST', country: 'ZZ' })) } }
      : Object.fromEntries(Array.from({ length: count }, (_, i) => [`p${i}`, i]));
    const fields = duplicate ? Array(count).fill('asn.routes.route').join(',') : Object.keys(source).join(',');
    const original = JSON.stringify(source);
    const { result, operations } = measuredProjection(source, { fields, rootKey: duplicate ? 'asn' : undefined });
    assert.deepEqual(result, duplicate ? { asn: { routes: source.asn.routes.map(({ route }) => ({ route })) } } : source);
    assert.equal(JSON.stringify(source), original);
    assert.ok(operations <= 30 * (count * 3 + count * 4), `${operations} operations exceed the selector/property work budget`);
  });
}

for (const unknown of [false, true]) {
  test('exclusion projection has bounded work for ' + (unknown ? 'unknown route selectors' : 'sparse route selectors'), () => {
    const count = 800;
    const source = { asn: { routes: Array.from({ length: count }, (_, i) => ({ [`p${i}`]: i })) } };
    const excludes = Array.from({ length: count }, (_, i) => `asn.routes.${unknown ? 'missing' : 'p'}${i}`).join(',');
    const original = JSON.stringify(source);
    const { result, operations } = measuredProjection(source, { excludes, rootKey: 'asn' });
    assert.deepEqual(result, unknown ? source : { asn: { routes: Array.from({ length: count }, () => ({})) } });
    assert.equal(JSON.stringify(source), original);
    assert.ok(operations <= 30 * (count * 3 + count), `${operations} operations exceed the selector/property work budget`);
  });
}

const exclusionCases = [
  [{ foo: 1, asn: { foo: 2, keep: 3 } }, 'foo,foo', { asn: { keep: 3 } }],
  [{ foo: { x: 1 }, asn: { foo: { x: 2 }, keep: 3 } }, 'foo.x,foo.x', { asn: { keep: 3 } }],
  [{ foo: { x: 1, y: 2 }, asn: { foo: { x: 3, y: 4 }, keep: 5 } }, 'foo.x,foo.y,foo.x', { asn: { foo: { y: 4 }, keep: 5 } }],
  [{ foo: { x: 1, y: 2 }, asn: { foo: { x: 3, y: 4 }, keep: 5 } }, 'foo.x,foo,foo.y', { asn: { foo: { x: 3 }, keep: 5 } }],
  [{ foo: { x: 1 }, asn: { foo: { x: 2 }, keep: 3 } }, 'foo.x,asn,foo.x', {}],
  [{ foo: [{ x: 1 }], asn: { foo: { x: 2 }, keep: 3 } }, 'foo.x,foo.x', { foo: [{}], asn: { foo: { x: 2 }, keep: 3 } }],
  [{ foo: {}, asn: { foo: { x: 2 }, keep: 3 } }, 'foo.x,foo.x', { foo: {}, asn: { foo: { x: 2 }, keep: 3 } }],
  [{ foo: { x: 1 }, asn: { foo: { x: 2 }, keep: 3 } }, 'asn.foo.x,foo.x,foo.x', { asn: { keep: 3 } }],
  [{ foo: { x: 1 }, asn: { foo: { x: 2 }, keep: 3 } }, 'foo.x,foo.x,foo', { asn: { keep: 3 } }],
];
for (const [index, [source, excludes, expected]] of exclusionCases.entries()) {
  test(`excludes retain ordered root-relative fallback ${index + 1}`, () => {
    const original = structuredClone(source);
    assert.deepEqual(applyFieldsAndExcludes(source, { excludes, rootKey: 'asn' }), expected);
    assert.deepEqual(source, original);
  });
}

test('compiled selectors preserve source order, empty segments, own keys and parent selection', () => {
  const source = JSON.parse('{"z":0,"__proto__":{"safe":1},"constructor":{"value":2},"a":{"":3,"x":4},"asn":{"routes":[{"route":"one","country":"ZZ"},{"country":"YY"},null,[{"route":"nested"}]]},"ip":"192.0.2.1"}');
  const selected = applyFieldsAndExcludes(source, { fields: 'constructor.value,__proto__.safe,a.,asn.routes.route,z', preserveIp: true });
  assert.equal(JSON.stringify(selected), '{"z":0,"__proto__":{"safe":1},"constructor":{"value":2},"a":{"":3},"asn":{"routes":[{"route":"one"},{},null,[{"route":"nested"}]]},"ip":"192.0.2.1"}');
  assert.deepEqual(applyFieldsAndExcludes(source, { fields: 'routes.route,asn', rootKey: 'asn' }), { asn: source.asn });
  assert.deepEqual(applyFieldsAndExcludes(source, { fields: 'asn,routes.route', rootKey: 'asn' }), { asn: source.asn });
  assert.equal(Object.hasOwn(selected, '__proto__'), true);
  assert.equal(Object.hasOwn(selected, 'constructor'), true);
  assert.equal({}.safe, undefined);
  assert.deepEqual(applyFieldsAndExcludes({ a: { '': 1, b: 2 } }, { excludes: 'a.' }), { a: { b: 2 } });
  assert.deepEqual(applyFieldsAndExcludes(Object.assign(Object.create({ inherited: 1 }), { own: 2 }), { fields: 'inherited,own' }), { own: 2 });
  assert.deepEqual(applyFieldsAndExcludes({ rows: [{ present: 1 }, null, []] }, { fields: 'rows.missing' }), { rows: [{}, null, []] });
  assert.deepEqual(applyFieldsAndExcludes({ rows: [{ nested: {} }, { nested: [] }] }, { fields: 'rows.nested.missing' }), { rows: [{}, { nested: [] }] });
});
