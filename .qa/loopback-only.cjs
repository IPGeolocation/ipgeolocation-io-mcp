const traceFs = require('node:fs');
const traceAppend = traceFs.appendFileSync;
traceFs.appendFileSync = function (file, data, ...options) {
  if (file === process.env.IPGEO_QA_NETWORK_BLOCK_LOG && typeof data === 'string') {
    try {
      const event = JSON.parse(data);
      if (event.reason === 'external network access prevented') {
        event.processFile = require('node:path').basename(process.argv[1] || '');
        event.stackFrames = String(new Error().stack).split('\n').slice(1, 10);
        data = JSON.stringify(event) + '\n';
      }
    } catch {}
  }
  return traceAppend.call(this, file, data, ...options);
};
// Offline tests may use local HTTP fixtures; unexpected external calls must fail before I/O.
const net = require('node:net');
const tls = require('node:tls');
const dns = require('node:dns');
const dgram = require('node:dgram');
const { syncBuiltinESMExports } = require('node:module');

function blocked() {
  if (process.env.IPGEO_QA_NETWORK_BLOCK_LOG) {
    require('node:fs').appendFileSync(process.env.IPGEO_QA_NETWORK_BLOCK_LOG, JSON.stringify({ pid: process.pid, reason: 'external network access prevented' }) + '\n');
  }
  const error = new Error('External network access is disabled in offline tests');
  error.code = 'ERR_TEST_NETWORK_BLOCKED';
  throw error;
}

function isLoopback(host) {
  if (typeof host !== 'string') return false;
  host = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost') return true;
  if (net.isIP(host) === 4) return host.startsWith('127.');
  if (net.isIP(host) !== 6) return false;
  return new URL(`http://[${host}]`).hostname === '[::1]';
}

function checkHost(host) {
  if (!isLoopback(host)) blocked();
}

function checkConnection(args) {
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  const first = normalized[0];
  if (first && typeof first === 'object') {
    if (first.path) {
      // Windows pipes must be local; remote UNC paths can open network connections.
      if (process.platform === 'win32' && !first.path.startsWith('\\\\.\\pipe\\')) blocked();
      return;
    }
    checkHost(first.host ?? first.hostname ?? 'localhost');
    if (first.lookup) {
      const lookup = first.lookup;
      first.lookup = (host, options, callback) => lookup(host, options, (error, address, family) => {
        if (!error) {
          for (const item of Array.isArray(address) ? address : [{ address }]) checkHost(item.address);
        }
        callback(error, address, family);
      });
    }
    return;
  }
  if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
    checkHost(typeof normalized[1] === 'string' ? normalized[1] : 'localhost');
    return;
  }
  if (typeof first === 'string' && (first.startsWith('\\\\.\\pipe\\') || (process.platform !== 'win32' && first.startsWith('/')))) return;
  blocked();
}

for (const [object, name] of [[net.Socket.prototype, 'connect'], [tls, 'connect']]) {
  const original = object[name];
  object[name] = function (...args) {
    checkConnection(args);
    return original.apply(this, args);
  };
}

function lookup(host, options = {}) {
  checkHost(host);
  const family = typeof options === 'number' ? options : options.family;
  const address = host.toLowerCase() === 'localhost' ? (family === 6 ? '::1' : '127.0.0.1') : host.replace(/^\[|\]$/g, '');
  const result = { address, family: net.isIP(address) };
  return options.all ? [result] : result;
}
dns.lookup = (host, options, callback) => {
  if (typeof options === 'function') { callback = options; options = {}; }
  const result = lookup(host, options);
  queueMicrotask(() => Array.isArray(result) ? callback(null, result) : callback(null, result.address, result.family));
};
dns.promises.lookup = async (host, options) => lookup(host, options);
for (const object of [dns, dns.promises, dns.Resolver.prototype, dns.promises.Resolver.prototype]) {
  for (const name of Object.getOwnPropertyNames(object)) {
    if (name.startsWith('resolve') || name === 'reverse' || name === 'lookupService') object[name] = blocked;
  }
}
dgram.Socket.prototype.connect = blocked;
dgram.Socket.prototype.send = blocked;

const originalFetch = globalThis.fetch;
globalThis.fetch = async function (input, options) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') blocked();
  checkHost(url.hostname);
  return originalFetch(input, options);
};
syncBuiltinESMExports();

const filename = __filename.replaceAll('\\', '/');
if (!(process.env.NODE_OPTIONS || '').includes(filename)) {
  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} --require=${JSON.stringify(filename)}`.trim();
}
