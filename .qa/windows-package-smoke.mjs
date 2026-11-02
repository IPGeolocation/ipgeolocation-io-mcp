import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,mkdtemp,access,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

assert.equal(process.platform,'win32','This check requires native Windows.');
const repo=process.cwd();
const output=path.join(repo,'artifacts','windows-platform');
await mkdir(output,{recursive:true});
const root=await mkdtemp(path.join(process.env.RUNNER_TEMP,'Windows package 調査 '));
const npmCli=path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
await access(npmCli);
const sourcePackage=JSON.parse(await readFile(path.join(repo,'package.json'),'utf8'));
const run=(args,cwd=repo,extra={})=>{
 const r=spawnSync(process.execPath,[npmCli,...args],{cwd,env:{...process.env,...extra},encoding:'utf8',windowsHide:true,timeout:240000});
 assert.equal(r.status,0,`${args[0]} failed: ${r.error?.message??r.stderr}`);return r.stdout;
};
await rm(path.join(repo,'dist'),{recursive:true,force:true});
run(['run','build']);
const packed=JSON.parse(run(['pack','--json','--ignore-scripts','--pack-destination',root]));
assert.equal(packed.length,1);
const archive=path.join(root,packed[0].filename);
const consumer=path.join(root,'Fresh consumer 調査');await mkdir(consumer);
await writeFile(path.join(consumer,'package.json'),JSON.stringify({name:'windows-package-check',private:true,version:'0.0.0'}));
run(['install','--ignore-scripts','--no-audit','--no-fund',archive],consumer);
const installed=path.join(consumer,'node_modules','ipgeolocation-io-mcp');
assert.equal(JSON.parse(await readFile(path.join(installed,'package.json'),'utf8')).version,sourcePackage.version);
async function runtimeFiles(directory,prefix=''){const files=[];for(const entry of await readdir(directory,{withFileTypes:true})){const relative=prefix+entry.name;if(entry.isDirectory())files.push(...await runtimeFiles(path.join(directory,entry.name),relative+'/'));else files.push(relative);}return files.sort();}
const compiledFiles=await runtimeFiles(path.join(repo,'dist'));
assert.deepEqual(await runtimeFiles(path.join(installed,'dist')),compiledFiles);
const preparedDist=path.join(repo,'artifacts','Windows bundle QA','dist');
assert.deepEqual(await runtimeFiles(preparedDist),compiledFiles);
const compiledSha256={},normalizedCompiledSha256={},preparedCompiledSha256={};
for(const relative of compiledFiles){
 const sourceBytes=await readFile(path.join(repo,'dist',relative));
 const preparedBytes=await readFile(path.join(preparedDist,relative));
 assert.deepEqual(await readFile(path.join(installed,'dist',relative)),sourceBytes,`Fresh package differs: ${relative}`);
 assert.deepEqual(preparedBytes,sourceBytes,`Prepared bundle differs: ${relative}`);
 compiledSha256[relative]=createHash('sha256').update(sourceBytes).digest('hex');
 normalizedCompiledSha256[relative]=createHash('sha256').update(sourceBytes.toString('utf8').replace(/\r\n/g,'\n')).digest('hex');
 preparedCompiledSha256[relative]=createHash('sha256').update(preparedBytes).digest('hex');
}
const fixture=path.join(root,'offline-fetch.mjs');
await writeFile(fixture,`globalThis.fetch=async(input,init={})=>{const u=new URL(input);if(u.origin!=='https://api.ipgeolocation.io')throw new Error('Unexpected mock destination');console.error('WINDOWS_QA_UPSTREAM_CALL');const row={ip:u.searchParams.get('ip')||'203.0.113.10',company:{name:'Fixture Company'},asn:{as_number:'AS15169'},network:{route:'8.8.8.0/24'},currency:{code:'TST'},country_metadata:{tld:'.test'},security:{is_vpn:false},astronomy:[{date:'2026-01-01'}]};if(u.searchParams.get('ip')==='8.8.4.4')row.large='界😀'.repeat(12000);const body=init.body?JSON.parse(init.body):{};return new Response(JSON.stringify(body.ips?body.ips.map(ip=>({...row,ip})):body.uaStrings?body.uaStrings.map(user_agent_string=>({user_agent_string})):u.pathname==='/v3/user-agent'?{user_agent_string:body.uaString||'Synthetic-UA'}:row));};\n`);
const cases=[
 {name:'installed-node-entry',command:process.execPath,args:[path.join(installed,'dist','cli.js')],cwd:consumer},
 {name:'native-command-shim',command:path.join(consumer,'node_modules','.bin','ipgeolocation-io-mcp.cmd'),args:[],cwd:consumer},
 {name:'bare-npx',command:'npx',args:['--offline','--no','ipgeolocation-io-mcp'],cwd:consumer},
 {name:'explicit-npx-cmd',command:'npx.cmd',args:['--offline','--no','ipgeolocation-io-mcp'],cwd:consumer},
 {name:'prepared-bundle-runtime',command:process.execPath,args:[path.join(repo,'artifacts','Windows bundle QA','dist','cli.js')],cwd:path.join(repo,'artifacts','Windows bundle QA')},
];
const inputs={lookup_ip:{ip:'8.8.8.8'},bulk_lookup_ip:{ips:['8.8.8.8','1.1.1.1']},lookup_company:{ip:'8.8.8.8'},lookup_currency:{ip:'8.8.8.8'},lookup_network:{ip:'8.8.8.8'},check_security:{ip:'8.8.8.8'},bulk_security_check:{ips:['8.8.8.8']},lookup_asn:{asn:'AS15169'},get_abuse_contact:{ip:'8.8.8.8'},get_timezone:{tz:'UTC'},convert_timezone:{tz_from:'UTC',tz_to:'Asia/Karachi'},get_astronomy:{location:'Karachi, PK',date:'2026-01-01'},get_astronomy_time_series:{location:'Karachi, PK',dateStart:'2026-01-01',dateEnd:'2026-01-02'},parse_user_agent:{uaString:'Synthetic-UA'},bulk_parse_user_agent:{uaStrings:['Synthetic-UA','Other-UA']},get_my_ip:{}};
const results=[];
for(const testCase of cases){
 const transport=new StdioClientTransport({...testCase,stderr:'pipe',env:{IPGEOLOCATION_API_KEY:'windows-platform-synthetic-key',IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS:'10000',NODE_OPTIONS:`--import=${pathToFileURL(fixture).href}`}});
 let stderr='';transport.stderr.on('data',chunk=>{stderr+=chunk.toString()});
 const client=new Client({name:'windows-package-check',version:'1.0.0'});
 try{
  await client.connect(transport,{timeout:30000});assert.equal(client.getServerVersion().version,sourcePackage.version);assert.ok(client.getInstructions());
  const {tools}=await client.listTools();assert.equal(tools.length,17);assert.ok(tools.some(x=>x.name==='get_cached_result'));
  for(const [name,args]of Object.entries(inputs)){const result=await client.callTool({name,arguments:args},undefined,{timeout:10000});assert.equal(result.isError,undefined,`${testCase.name}: ${name}: ${JSON.stringify(result)}`);}
  const invalid=await client.callTool({name:'lookup_ip',arguments:{unexpected:true}});assert.equal(invalid.isError,true);assert.equal(invalid.structuredContent.error.category,'validation');
  let result=await client.callTool({name:'lookup_ip',arguments:{ip:'8.8.4.4'}});assert.ok(result.structuredContent.page);await new Promise(r=>setTimeout(r,25));const before=(stderr.match(/WINDOWS_QA_UPSTREAM_CALL/g)||[]).length;
  let serialized='',pageCount=0;
  for(;;){const page=result.structuredContent.page;assert.equal(page.offset,serialized.length);serialized+=page.json_fragment;pageCount++;if(!page.next_cursor)break;result=await client.callTool({name:'get_cached_result',arguments:{cursor:page.next_cursor}});assert.equal(result.isError,undefined);}
  assert.equal(JSON.parse(serialized).data.large,'界😀'.repeat(12000));assert.ok(pageCount>1);await new Promise(r=>setTimeout(r,25));assert.equal((stderr.match(/WINDOWS_QA_UPSTREAM_CALL/g)||[]).length,before,'Pagination repeated an upstream request');
  results.push({name:testCase.name,toolCount:tools.length,allApiToolsSynthetic:true,completePagination:true,pages:pageCount});
 }finally{await client.close();}
 assert.doesNotMatch(stderr,/windows-platform-synthetic-key/);
}
const keylessTransport=new StdioClientTransport({command:path.join(consumer,'node_modules','.bin','ipgeolocation-io-mcp.cmd'),args:[],cwd:consumer,stderr:'pipe',env:{IPGEOLOCATION_API_KEY:'',NODE_OPTIONS:`--import=${pathToFileURL(fixture).href}`}});
let keylessStderr='';keylessTransport.stderr.on('data',chunk=>{keylessStderr+=chunk.toString()});
const keylessClient=new Client({name:'windows-keyless-check',version:'1.0.0'});
try{
 await keylessClient.connect(keylessTransport,{timeout:30000});assert.equal((await keylessClient.listTools()).tools.length,17);
 const ip=await keylessClient.callTool({name:'get_my_ip',arguments:{}});assert.equal(ip.isError,undefined);assert.equal(ip.structuredContent.ip,'203.0.113.10');
 const protectedResult=await keylessClient.callTool({name:'lookup_ip',arguments:{ip:'8.8.8.8'}});assert.equal(protectedResult.isError,true);assert.match(protectedResult.structuredContent.error.message,/API key not configured/);
}finally{await keylessClient.close();}
assert.equal((keylessStderr.match(/WINDOWS_QA_UPSTREAM_CALL/g)||[]).length,1,'A protected keyless lookup reached the upstream fixture');
const direct=spawnSync(process.execPath,[path.join(repo,'scripts','prepare-mpak-package.mjs')],{cwd:repo,env:{...process.env,npm_execpath:'',MPAK_STAGING_DIR:'artifacts/Unsupported direct Windows invocation'},encoding:'utf8',windowsHide:true,timeout:30000});
assert.notEqual(direct.status,0);assert.match(direct.stderr,/On Windows, run npm run prepare:mpak/);
const report={compiledFilesCompared:compiledFiles.length,compiledSha256,normalizedCompiledSha256,preparedCompiledSha256,archiveSha256:createHash('sha256').update(await readFile(archive)).digest('hex'),platform:process.platform,arch:process.arch,node:process.version,sourceVersion:sourcePackage.version,sourceUnreleased:true,launches:results,unsupportedDirectInvocationHelpful:true,keylessShimChecked:true,providerApiCalls:0,paidApiCalls:0,published:false};
await writeFile(path.join(output,'native-package-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
