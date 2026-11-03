import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
const root=resolve(process.env.SERVER_RUNTIME_ROOT??fileURLToPath(new URL("../dist", import.meta.url)));
const {createMcpServer}=await import(pathToFileURL(`${root}/index.js`).href);
const {clearToolCacheForTests}=await import(pathToFileURL(`${root}/tools/cache.js`).href);
const deferred=()=>Promise.withResolvers(),turn=()=>new Promise(r=>setImmediate(r));
const full={ip:'8.8.8.8',include:'security'},target={...full,fields:'security.is_vpn'};
const row=(generation,request)=>({ip:'8.8.8.8',security:{is_vpn:generation%2===0},...(request.url.searchParams.has('fields')?{}:{generation})});
async function setup(t,responder,toolName='lookup_ip'){
 clearToolCacheForTests();const saved=globalThis.fetch,sessions=[],requests=[];
 globalThis.fetch=async(input,options={})=>{const request={url:new URL(input),options};assert.equal(request.url.origin,'https://api.ipgeolocation.io');requests.push(request);const value=await responder(request,requests.length);return value instanceof Response?value:new Response(JSON.stringify(value))};
 t.after(async()=>{for(const{server,client}of sessions){await client.close();await server.close()}clearToolCacheForTests();globalThis.fetch=saved;await turn()});
 async function session(){const server=createMcpServer({apiKey:'extended-races-synthetic-key'}),client=new Client({name:'extended-races',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);await client.listTools();sessions.push({server,client});return{client,server,call:(args,options)=>client.callTool({name:toolName,arguments:args},undefined,options)}}
 return{session,requests};
}
const orders=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
for(const latestFull of[false,true])for(const order of orders){
 test(`three competing variants, latest ${latestFull?'full':'target'}, completion ${order.join('-')}`,async t=>{
  const gates=[deferred(),deferred(),deferred()],started=gates.map(()=>deferred());t.after(()=>gates.forEach(g=>g.resolve()));
  const{session,requests}=await setup(t,async(request,count)=>{if(count<=3){started[count-1].resolve();await gates[count-1].promise}return row(count,request)});
  const{call}=await session();const args=latestFull?[full,target,full]:[target,full,target],pending=[];
  for(let i=0;i<3;i++){pending.push(call({...args[i],...(i?{force_refresh:true}:{})}));await started[i].promise}
  for(const i of order){gates[i].resolve();assert.equal((await pending[i]).isError,undefined)}
  const cachedTarget=await call(target);assert.equal(cachedTarget.structuredContent.data.security.is_vpn,false);assert.equal(requests.length,3);
  const cachedFull=await call(full);
  assert.equal(cachedFull.structuredContent.data.generation,latestFull?3:4);
  assert.equal(requests.length,latestFull?3:4);
 });
}
for(const olderFirst of[false,true]){
 test(`failed latest force cannot preserve pre-refresh data after an earlier success (${olderFirst?'older first':'older last'})`,async t=>{
  const old=deferred(),fresh=deferred(),oldStarted=deferred(),freshStarted=deferred();t.after(()=>{old.resolve();fresh.resolve()});
  const{session,requests}=await setup(t,async(request,count)=>{if(count===2){oldStarted.resolve();await old.promise}if(count===3){freshStarted.resolve();await fresh.promise;throw new Error('Synthetic newest force failure')}return row(count,request)});
  const{call}=await session();await call(full);const older=call({...full,force_refresh:true});await oldStarted.promise;
  const newer=call({...target,force_refresh:true});await freshStarted.promise;
  if(olderFirst){old.resolve();await older;fresh.resolve();assert.equal((await newer).isError,true)}else{fresh.resolve();assert.equal((await newer).isError,true);old.resolve();await older}
  assert.equal((await call(full)).structuredContent.data.generation,4);assert.equal(requests.length,4);
  assert.equal((await call(full)).structuredContent.data.generation,4);assert.equal(requests.length,4);
 });
}

test('cancelled superseding force cannot abort a live refresh or preserve pre-refresh data',async t=>{
 const old=deferred(),fresh=deferred(),oldStarted=deferred(),freshStarted=deferred();t.after(()=>{old.resolve();fresh.resolve()});
 let oldSignal,freshSignal;
 const{session,requests}=await setup(t,async(request,count)=>{if(count===2){oldSignal=request.options.signal;oldStarted.resolve();await old.promise}if(count===3){freshSignal=request.options.signal;freshStarted.resolve();await fresh.promise}return row(count,request)});
 const{call}=await session();await call(full);const older=call({...full,force_refresh:true});await oldStarted.promise;
 const controller=new AbortController(),newer=call({...target,force_refresh:true},{signal:controller.signal}),outcome=Promise.allSettled([newer]);await freshStarted.promise;
 controller.abort(new Error('Synthetic newest force cancelled'));assert.equal((await outcome)[0].status,'rejected');await turn();await turn();assert.equal(freshSignal.aborted,true);assert.equal(oldSignal.aborted,false);
 fresh.resolve();await turn();old.resolve();assert.equal((await older).isError,undefined);await turn();
 assert.equal((await call(full)).structuredContent.data.generation,4);assert.equal(requests.length,4);
 assert.equal((await call(full)).structuredContent.data.generation,4);assert.equal(requests.length,4);
});

for (const toolName of ['lookup_ip', 'bulk_security_check']) {
 test(`${toolName} reuses the original pending lookup after a forced refresh is cancelled`, async t => {
  const original=deferred(),refresh=deferred(),originalStarted=deferred(),refreshStarted=deferred();
  t.after(()=>{original.resolve();refresh.resolve()});
  let originalSignal,refreshSignal;
  const {session,requests}=await setup(t,async(request,count)=>{
   if(count===1){originalSignal=request.options.signal;originalStarted.resolve();await original.promise;}
   if(count===2){refreshSignal=request.options.signal;refreshStarted.resolve();await refresh.promise;}
   const value={ip:'8.8.8.8',security:{threat_score:count}};
   return toolName==='bulk_security_check'?[value]:value;
  },toolName);
  const {call,client}=await session(),args=toolName==='bulk_security_check'?{ips:['8.8.8.8']}:{ip:'8.8.8.8',include:'security'};
  const first=call(args);await originalStarted.promise;
  const controller=new AbortController(),forced=call({...args,force_refresh:true},{signal:controller.signal}),outcome=Promise.allSettled([forced]);
  await refreshStarted.promise;controller.abort();assert.equal((await outcome)[0].status,'rejected');
  await client.ping();await turn();
  assert.equal(refreshSignal.aborted,true);assert.equal(originalSignal.aborted,false);
  const joined=call(args);await client.ping();assert.equal(requests.length,2);
  original.resolve();const firstResult=await first,joinedResult=await joined;
  assert.deepEqual(joinedResult.structuredContent,firstResult.structuredContent);
  refresh.resolve();await turn();
  assert.deepEqual((await call(args)).structuredContent,firstResult.structuredContent);
  assert.equal(requests.length,2,'joining and reading the cached result must not spend credits again');
 });
}

for (const toolName of ['lookup_ip', 'check_security', 'bulk_security_check']) for (const failure of ['http', 'connection']) {
 test(`${toolName} reuses a live normal lookup after a forced ${failure} failure`, async t => {
  const original=deferred(),originalStarted=deferred();t.after(()=>original.resolve());
  let originalSignal;
  const {session,requests}=await setup(t,async(request,count)=>{
   if(count===1){originalSignal=request.options.signal;originalStarted.resolve();await original.promise;}
   if(count===2){
    if(failure==='connection')throw new Error('Synthetic refresh connection failure');
    return new Response(JSON.stringify({message:'Synthetic refresh unavailable'}),{status:503});
   }
   const value={ip:'8.8.8.8',security:{threat_score:count}};
   return toolName==='bulk_security_check'?[value]:value;
  },toolName);
  const {call,client}=await session(),args=toolName==='bulk_security_check'?{ips:['8.8.8.8']}:toolName==='lookup_ip'?{ip:'8.8.8.8',include:'security'}:{ip:'8.8.8.8'};
  const first=call(args);await originalStarted.promise;
  const failed=await call({...args,force_refresh:true});
  assert.equal(failed.isError,true);
  assert.equal(failed.structuredContent.error.status,failure==='http'?503:502);
  assert.equal(originalSignal.aborted,false);
  const joined=call(args);await client.ping();assert.equal(requests.length,2);
  original.resolve();const firstResult=await first,joinedResult=await joined;
  assert.deepEqual(joinedResult.structuredContent,firstResult.structuredContent);
  assert.deepEqual((await call(args)).structuredContent,firstResult.structuredContent);
  assert.equal(requests.length,2,'sharing and caching the original lookup must avoid a third request');
 });
}

test('an abandoned request that ignores abort cannot overwrite an immediate replacement',async t=>{
 const old=deferred(),started=deferred();t.after(()=>old.resolve());let oldSignal;
 const{session,requests}=await setup(t,async(request,count)=>{if(count===1){oldSignal=request.options.signal;started.resolve();await old.promise}return row(count,request)});
 const a=await session(),b=await session(),controller=new AbortController();
 const original=a.call(full,{signal:controller.signal}),outcome=Promise.allSettled([original]);await started.promise;controller.abort(new Error('Synthetic abandon'));assert.equal((await outcome)[0].status,'rejected');await turn();assert.equal(oldSignal.aborted,true);
 const replacement=await b.call(full);assert.equal(replacement.structuredContent.data.generation,2);old.resolve();await turn();await turn();
 assert.equal((await b.call(full)).structuredContent.data.generation,2);assert.equal(requests.length,2);
});

test('closing one session keeps another session subscribed to the same fetch',async t=>{
 const gate=deferred(),started=deferred();t.after(()=>gate.resolve());let signal;
 const{session,requests}=await setup(t,async(request,count)=>{signal=request.options.signal;started.resolve();await gate.promise;return row(count,request)});
 const a=await session(),b=await session(),first=a.call(full),firstOutcome=Promise.allSettled([first]);await started.promise;
 const second=b.call(full);await b.client.ping();await turn();await a.client.close();assert.equal((await firstOutcome)[0].status,'rejected');await turn();assert.equal(signal.aborted,false);
 gate.resolve();assert.equal((await second).structuredContent.data.generation,1);assert.equal(requests.length,1);
});

test('closing all owning sessions aborts shared work and allows a fresh session',async t=>{
 const gate=deferred(),started=deferred();t.after(()=>gate.resolve());let signal;
 const{session,requests}=await setup(t,async(request,count)=>{if(count===1){signal=request.options.signal;started.resolve();await gate.promise}return row(count,request)});
 const a=await session(),b=await session(),first=a.call(full),firstOutcome=Promise.allSettled([first]);await started.promise;
 const second=b.call(full),secondOutcome=Promise.allSettled([second]);await b.client.ping();await turn();await a.client.close();await b.client.close();await Promise.all([firstOutcome,secondOutcome]);await turn();assert.equal(signal.aborted,true);
 const c=await session();assert.equal((await c.call(full)).structuredContent.data.generation,2);gate.resolve();await turn();await turn();assert.equal((await c.call(full)).structuredContent.data.generation,2);assert.equal(requests.length,2);
});

test('a client-side MCP deadline cancels only its subscriber, preserving the live peer',async t=>{
 const gate=deferred(),started=deferred();t.after(()=>gate.resolve());let signal;
 const{session,requests}=await setup(t,async(request,count)=>{signal=request.options.signal;started.resolve();await gate.promise;return row(count,request)});
 const a=await session(),b=await session(),first=a.call(full,{timeout:75}),outcome=Promise.allSettled([first]);await started.promise;
 const second=b.call(full);await b.client.ping();await turn();assert.equal((await outcome)[0].status,'rejected');await turn();assert.equal(signal.aborted,false);
 gate.resolve();assert.equal((await second).structuredContent.data.generation,1);assert.equal(requests.length,1);
});

const securityRows = (request, generation) => JSON.parse(request.options.body).ips.map(ip => ({
 ip, security: { threat_score: generation, is_vpn: false },
}));

for(const toolName of ['check_security','bulk_security_check']) for(const olderFirst of [false,true]) {
 test(`${toolName} cannot return pre-refresh threat data after a success and a later failure (${olderFirst?'success first':'failure first'})`,async t=>{
  const a=deferred(),b=deferred(),aStarted=deferred(),bStarted=deferred();t.after(()=>{a.resolve();b.resolve()});
  const {session,requests}=await setup(t,async(request,count)=>{
   if(count===2){aStarted.resolve();await a.promise;}
   if(count===3){bStarted.resolve();await b.promise;return new Response(JSON.stringify({message:'Synthetic newer refresh unavailable'}),{status:503});}
   const score=count===1?5:count===2?90:100;
   return toolName==='check_security'?{ip:'8.8.8.8',security:{threat_score:score,is_vpn:false}}:securityRows(request,score);
  },toolName);
  const {call}=await session(),args=toolName==='check_security'?{ip:'8.8.8.8'}:{ips:['8.8.8.8']};
  const score=result=>(toolName==='check_security'?result.structuredContent.data:result.structuredContent.items[0]).security.threat_score;
  assert.equal(score(await call(args)),5);
  const older=call({...args,force_refresh:true});await aStarted.promise;
  const newer=call({...args,fields:'security.threat_score',force_refresh:true});await bStarted.promise;
  if(olderFirst){a.resolve();assert.equal(score(await older),90);b.resolve();assert.equal((await newer).isError,true);}
  else{b.resolve();assert.equal((await newer).isError,true);a.resolve();assert.equal(score(await older),90);}
  await turn();assert.equal(requests.length,3,'a failed overlap must not automatically repeat a paid request');
  assert.equal(score(await call(args)),100);assert.equal(requests.length,4);
  assert.equal(score(await call(args)),100);assert.equal(requests.length,4);
 });
}

for (const refreshFull of [false, true]) {
 test(`bulk security ${refreshFull ? 'full' : 'targeted'} refresh invalidates sibling views`, async t => {
  const {session, requests} = await setup(t, securityRows, 'bulk_security_check');
  const {call} = await session();
  const complete = {ips: ['8.8.8.8']}, projected = {...complete, fields: 'security.threat_score'};
  const cached = refreshFull ? projected : complete, refreshed = refreshFull ? complete : projected;
  assert.equal((await call(cached)).structuredContent.items[0].security.threat_score, 1);
  assert.equal((await call({...refreshed, force_refresh: true})).structuredContent.items[0].security.threat_score, 2);
  assert.equal((await call(cached)).structuredContent.items[0].security.threat_score, 3);
  assert.equal((await call(cached)).structuredContent.items[0].security.threat_score, 3);
  assert.equal(requests.length, 3);
 });
}

test('an older bulk security view cannot repopulate the cache after refresh', async t => {
 const started = deferred(), gate = deferred();
 t.after(() => gate.resolve());
 const {session, requests} = await setup(t, async (request, count) => {
  if (count === 1) {started.resolve(); await gate.promise;}
  return securityRows(request, count);
 }, 'bulk_security_check');
 const {call} = await session(), projected = {ips: ['8.8.8.8'], fields: 'security.threat_score'};
 const older = call(projected);
 await started.promise;
 assert.equal((await call({ips: projected.ips, force_refresh: true})).structuredContent.items[0].security.threat_score, 2);
 gate.resolve(); await older;
 assert.equal((await call(projected)).structuredContent.items[0].security.threat_score, 3);
 assert.equal(requests.length, 3);
});

test('failed bulk security refresh preserves valid sibling views and other batches', async t => {
 const {session, requests} = await setup(t, (request, count) => count === 4
  ? new Response(JSON.stringify({message: 'Synthetic unavailable'}), {status: 503})
  : securityRows(request, count), 'bulk_security_check');
 const {call} = await session(), complete = {ips: ['8.8.8.8']};
 const projected = {...complete, fields: 'security.threat_score'}, other = {ips: ['1.1.1.1']};
 const originalFull = await call(complete), originalProjected = await call(projected), originalOther = await call(other);
 assert.equal((await call({...complete, force_refresh: true})).isError, true);
 assert.deepEqual((await call(complete)).structuredContent, originalFull.structuredContent);
 assert.deepEqual((await call(projected)).structuredContent, originalProjected.structuredContent);
 assert.deepEqual((await call(other)).structuredContent, originalOther.structuredContent);
 assert.equal(requests.length, 4);
});
