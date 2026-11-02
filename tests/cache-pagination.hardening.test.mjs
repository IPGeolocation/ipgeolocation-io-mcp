import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=resolve(process.env.SERVER_RUNTIME_ROOT??fileURLToPath(new URL('../dist',import.meta.url)));
const cache=await import(pathToFileURL(`${root}/tools/cache.js`).href);
const config=await import(pathToFileURL(`${root}/config.js`).href);
const pagination=await import(pathToFileURL(`${root}/tools/pagination.js`).href);
const scope=fn=>config.withRuntimeConfig({apiKey:'cache-pagination-hardening-synthetic-key'},fn);
const deferred=()=>Promise.withResolvers();
const MiB=1024*1024;

function setup(t) {
 const names=['IPGEOLOCATION_MCP_CACHE_MAX_BYTES','IPGEOLOCATION_MCP_CACHE_TTL_MS','IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS'];
 const previous=names.map(name=>process.env[name]);
 Object.assign(process.env,{IPGEOLOCATION_MCP_CACHE_MAX_BYTES:String(4*MiB),IPGEOLOCATION_MCP_CACHE_TTL_MS:'1000',IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS:'10000'});
 cache.clearToolCacheForTests();
 t.after(()=>{cache.clearToolCacheForTests();names.forEach((name,i)=>{if(previous[i]===undefined)delete process.env[name];else process.env[name]=previous[i]})});
}

for(const family of [undefined,'security-family']) for(const olderFirst of [false,true]) {
 test(`superseded success invalidates older ${family?'family':'single-key'} values, completes ${olderFirst?'first':'last'}`,async t=>{
  setup(t);
  await scope(async()=>{
   const a=deferred(),b=deferred();t.after(()=>{a.resolve({score:90});b.resolve({score:100})});
   const target='security-full', projected=family?'security-projection':target;
   await cache.getCachedOrFetchValue(target,async()=>({score:5}),false,()=>true,family);
   if(family)await cache.getCachedOrFetchValue(projected,async()=>({score:5}),false,()=>true,family);
   await cache.getCachedOrFetchValue('unrelated',async()=>({score:7}),false,()=>true,'other-family');
   const older=cache.getCachedOrFetchValue(target,()=>a.promise,true,()=>true,family);
   const newer=cache.getCachedOrFetchValue(projected,()=>b.promise,true,()=>true,family);
   const rejected=assert.rejects(newer,/Synthetic newest failure/);
   if(olderFirst){a.resolve({score:90});assert.equal((await older).score,90);b.reject(new Error('Synthetic newest failure'));await rejected;}
   else{b.reject(new Error('Synthetic newest failure'));await rejected;a.resolve({score:90});assert.equal((await older).score,90);}
   assert.equal(cache.getCachedValue(target),undefined);
   assert.equal(cache.getCachedValue(projected),undefined);
   assert.deepEqual(cache.getCachedValue('unrelated'),{score:7});
  });
 });
}

test('late superseded success cannot invalidate a newer cached success or another key',async t=>{
 setup(t);
 await scope(async()=>{
  await cache.getCachedOrFetchValue('full',async()=>({score:5}),false,()=>true,'family');
  const a=deferred();t.after(()=>a.resolve({score:90}));
  const older=cache.getCachedOrFetchValue('full',()=>a.promise,true,()=>true,'family');
  await cache.getCachedOrFetchValue('projected',async()=>({score:100}),true,()=>true,'family');
  await config.withRuntimeConfig({apiKey:'another-cache-pagination-synthetic-key'},()=>cache.getCachedOrFetchValue('full',async()=>({score:8}),false,()=>true,'family'));
  a.resolve({score:90});await older;
  assert.deepEqual(cache.getCachedValue('projected'),{score:100});
  assert.equal(cache.getCachedValue('full'),undefined);
  assert.deepEqual(config.withRuntimeConfig({apiKey:'another-cache-pagination-synthetic-key'},()=>cache.getCachedValue('full')),{score:8});
 });
});

for(const forceFinishesFirst of [false,true]) {
 test(`a later normal sibling during refresh remains cached when force completes ${forceFinishesFirst?'first':'last'}`,async t=>{
  setup(t);
  await scope(async()=>{
   await cache.getCachedOrFetchValue('full',async()=>({score:5}),false,()=>true,'family');
   const a=deferred(),b=deferred();t.after(()=>{a.resolve({score:90});b.resolve({score:100})});
   const force=cache.getCachedOrFetchValue('full',()=>a.promise,true,()=>true,'family');
   const normal=cache.getCachedOrFetchValue('projected',()=>b.promise,false,()=>true,'family');
   if(forceFinishesFirst){a.resolve({score:90});await force;b.resolve({score:100});await normal;}
   else{b.resolve({score:100});await normal;a.resolve({score:90});await force;}
   assert.deepEqual(cache.getCachedValue('projected'),{score:100});
   assert.equal(cache.getCachedValue('full'),undefined,'the older full view must not shadow the later successful projection');
   assert.deepEqual(await cache.getCachedOrFetchValue('projected',()=>{throw new Error('A cached newer view must not pay again')},false,()=>true,'family'),{score:100});
  });
 });
}

test('a newer sibling success stays authoritative after cache pressure evicts its value',async t=>{
 setup(t);
 await scope(async()=>{
  await cache.getCachedOrFetchValue('full',async()=>({score:5}),false,()=>true,'family');
  const gate=deferred();t.after(()=>gate.resolve({score:90}));
  const force=cache.getCachedOrFetchValue('full',()=>gate.promise,true,()=>true,'family');
  await cache.getCachedOrFetchValue('projected',async()=>({score:100}),false,()=>true,'family');
  cache.setCachedValue('pressure-a','x'.repeat(3*MiB));
  cache.setCachedValue('pressure-b','x'.repeat(1.5*MiB));
  assert.equal(cache.getCachedValue('projected'),undefined);
  gate.resolve({score:90});await force;
  assert.equal(cache.getCachedValue('full'),undefined,'eviction must not revive an earlier refresh response');
 });
});

test('an uncached newer sibling success cannot be replaced by an earlier refresh',async t=>{
 setup(t);
 await scope(async()=>{
  await cache.getCachedOrFetchValue('full',async()=>({score:5}),false,()=>true,'family');
  const gate=deferred();t.after(()=>gate.resolve({score:90}));
  const force=cache.getCachedOrFetchValue('full',()=>gate.promise,true,()=>true,'family');
  const value=await cache.getCachedOrFetchValue('projected',async()=>({score:100,notes:'x'.repeat(4*MiB)}),false,()=>true,'family');
  assert.equal(value.score,100);assert.equal(cache.getCachedValue('projected'),undefined);
  gate.resolve({score:90});await force;
  assert.equal(cache.getCachedValue('full'),undefined);
 });
});

test('normal per-view caching outside a refresh keeps its existing TTL behavior',async t=>{
 setup(t);
 await scope(async()=>{
  const gate=deferred();t.after(()=>gate.resolve({score:90}));
  const full=cache.getCachedOrFetchValue('full',()=>gate.promise,false,()=>true,'family');
  await cache.getCachedOrFetchValue('projected',async()=>({score:100}),false,()=>true,'family');
  gate.resolve({score:90});await full;
  assert.deepEqual(cache.getCachedValue('full'),{score:90});
  assert.deepEqual(cache.getCachedValue('projected'),{score:100});
 });
});

test('a failed refresh alone preserves prior data and makes no implicit retry',async t=>{
 setup(t);
 await scope(async()=>{
  let calls=0;
  await cache.getCachedOrFetchValue('full',async()=>{calls++;return {score:5}},false,()=>true,'family');
  await assert.rejects(cache.getCachedOrFetchValue('full',async()=>{calls++;throw new Error('Synthetic failure')},true,()=>true,'family'));
  assert.deepEqual(await cache.getCachedOrFetchValue('full',async()=>{calls++;return {score:90}},false,()=>true,'family'),{score:5});
  assert.equal(calls,2);
 });
});

test('a superseded completion after a cache reset cannot invalidate replacement data',async t=>{
 setup(t);
 await scope(async()=>{
  await cache.getCachedOrFetchValue('full',async()=>({score:5}),false,()=>true,'family');
  const a=deferred(),b=deferred();t.after(()=>{a.resolve({score:90});b.resolve({score:95})});
  const older=cache.getCachedOrFetchValue('full',()=>a.promise,true,()=>true,'family');
  const newer=cache.getCachedOrFetchValue('full',()=>b.promise,true,()=>true,'family');
  cache.clearToolCacheForTests();
  await cache.getCachedOrFetchValue('full',async()=>({score:100}),false,()=>true,'family');
  a.resolve({score:90});await older;b.resolve({score:95});await newer;
  assert.deepEqual(cache.getCachedValue('full'),{score:100});
 });
});

test('quote-heavy JSON below the cache budget is retained and fully recovered',t=>{
 setup(t);
 scope(()=>{
  const structuredContent={data:{notes:'"'.repeat(1_250_000)}};
  const expected=JSON.stringify(structuredContent);
  assert.ok(Buffer.byteLength(expected)<4*MiB);
  let result=pagination.paginateToolResult('lookup_ip',{content:[{type:'text',text:expected}],structuredContent});
  const fragments=[];let pages=0;
  for(;;){
   const page=result.structuredContent.page;
   assert.ok(Buffer.byteLength(JSON.stringify(result))<=10000);
   fragments.push(page.json_fragment);pages++;
   if(!page.next_cursor)break;
   result=pagination.readCachedResultPage(page.next_cursor);
   assert.ok(pages<2000);
  }
  assert.equal(fragments.join(''),expected);
  assert.ok(pages>1);
 });
});

test('page reads refresh TTL without serializing the complete cached snapshot',t=>{
 setup(t);
 scope(()=>{
  const originalNow=Date.now;let now=100000;Date.now=()=>now;t.after(()=>{Date.now=originalNow});
  const structuredContent={data:{notes:'x'.repeat(30000)}};
  const first=pagination.paginateToolResult('lookup_ip',{content:[{type:'text',text:'x'.repeat(30000)}],structuredContent});
  const cursor=first.structuredContent.page.cursor;
  const snapshot=cache.getCachedValue(`result-page|${cursor.split(':')[0]}`);
  const originalStringify=JSON.stringify;let snapshotsSerialized=0;
  JSON.stringify=function(value,...args){if(value===snapshot)snapshotsSerialized++;return originalStringify(value,...args)};
  t.after(()=>{JSON.stringify=originalStringify});
  now+=999;
  const replay=pagination.readCachedResultPage(cursor);
  assert.equal(Date.parse(replay.structuredContent.page.expires_at),now+1000);
  now+=999;pagination.readCachedResultPage(cursor);
  assert.equal(snapshotsSerialized,0);
  now+=1000;assert.throws(()=>pagination.readCachedResultPage(cursor),/unavailable|expired/);
 });
});

test('invalid offsets do not extend cached-result expiry',t=>{
 setup(t);
 scope(()=>{
  const originalNow=Date.now;let now=100000;Date.now=()=>now;t.after(()=>{Date.now=originalNow});
  const first=pagination.paginateToolResult('lookup_ip',{content:[{type:'text',text:'x'.repeat(30000)}],structuredContent:{data:{notes:'x'.repeat(30000)}}});
  const cursor=first.structuredContent.page.cursor,id=cursor.split(':')[0];
  now+=999;assert.throws(()=>pagination.readCachedResultPage(`${id}:999999`),/cursor position/);
  now+=1;assert.throws(()=>pagination.readCachedResultPage(cursor),/unavailable|expired/);
 });
});

test('explicit retained-byte accounting is validated and still enforces total cache limits',t=>{
 setup(t);
 scope(()=>{
  assert.equal(cache.setCachedValue('existing',{value:1}),true);
  for(const bytes of [-1,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>cache.setCachedValue('existing',{value:2},bytes),/nonnegative safe integer/);
  assert.deepEqual(cache.getCachedValue('existing'),{value:1});
  assert.equal(cache.setCachedValue('too-large',{json:'x'},4*MiB),false);
  assert.equal(cache.getCachedValue('too-large'),undefined);
  assert.deepEqual(cache.getCachedValue('existing'),{value:1});
 });
});
