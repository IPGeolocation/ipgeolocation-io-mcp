import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import https from "node:https";
import { setTimeout as delay } from "node:timers/promises";

const image = process.env.MCP_DOCKER_IMAGE || "ipgeolocation-io-mcp:security-test";
const nginx = "nginx@sha256:901e593c95dc85f5a729f5765516321366ef4ac401821431d408897e95287d0a";
const docker = args => {
  const result = spawnSync("docker", args, { encoding: "utf8", timeout: 180000 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  return (result.stdout + (args[0] === "logs" ? result.stderr : "")).trim();
};
const openssl = args => execFileSync("openssl", args, { stdio: "ignore", timeout: 10000 });

test("hardened hosted container works through a real verified HTTPS/Nginx proxy", { timeout: 300000 }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), "ipgeo-hosted-tls-"));
  const id = randomUUID().slice(0, 8);
  const network = "ipgeo-hosted-" + id;
  const app = "ipgeo-hosted-app-" + id;
  const proxy = "ipgeo-hosted-proxy-" + id;
  const proxyImage = "ipgeo-hosted-nginx-qa:" + id;
  const key = "synthetic-tls-connection-key";
  t.after(async () => {
    for (const name of [proxy, app]) { try { docker(["rm", "--force", name]); } catch {} }
    try { docker(["network", "rm", network]); } catch {}
    try { docker(["image", "rm", proxyImage]); } catch {}
    await rm(root, { recursive: true, force: true });
  });
  openssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=IPGeo temporary test CA",
    "-keyout", path.join(root, "ca.key"), "-out", path.join(root, "ca.pem")]);
  openssl(["req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=127.0.0.1",
    "-keyout", path.join(root, "privkey.pem"), "-out", path.join(root, "server.csr")]);
  await writeFile(path.join(root, "extensions.cnf"), "subjectAltName=IP:127.0.0.1,DNS:mcp.test\nextendedKeyUsage=serverAuth\n", { mode: 0o600 });
  openssl(["x509", "-req", "-in", path.join(root, "server.csr"), "-CA", path.join(root, "ca.pem"),
    "-CAkey", path.join(root, "ca.key"), "-CAcreateserial", "-days", "1",
    "-extfile", path.join(root, "extensions.cnf"), "-out", path.join(root, "fullchain.pem")]);

  // Private random bridge: no public backend port and no application-folder mounts.
  docker(["network", "create", "--subnet", "172.30.99.0/29", network]);
  // Reserve a host port with Docker itself, then render the exact public authority.
  docker(["create", "--name", proxy, "--network", network, "--ip", "172.30.99.3",
    "--publish", "127.0.0.1::8443", nginx, "nginx", "-g", "daemon off;"]);
  // Docker assigns an ephemeral published port when starting, so use a first
  // short-lived placeholder then preserve its assigned port for the real proxy.
  docker(["start", proxy]);
  const assigned = JSON.parse(docker(["inspect", proxy]))[0].NetworkSettings.Ports["8443/tcp"][0].HostPort;
  docker(["rm", "--force", proxy]);
  assert.ok(/^\d+$/.test(assigned));
  const authority = "127.0.0.1:" + assigned;
  const url = new URL("https://" + authority + "/mcp");
  let site = await readFile(new URL("../deploy/hosted.nginx.conf", import.meta.url), "utf8");
  site = site.replaceAll("mcp.ipgeolocation.io", "127.0.0.1")
    .replace("listen 443 ssl;", "listen 8443 ssl;")
    .replaceAll("proxy_set_header Host 127.0.0.1;", "proxy_set_header Host " + authority + ";")
    .replaceAll("http://127.0.0.1:8787", "http://mcp:8787")
    .replace("/var/log/nginx/mcp.access.log", "/dev/stdout")
    .replace("/var/cache/nginx/mcp_body", "/tmp/client_temp");
  await writeFile(path.join(root, "site.conf"), site);
  await writeFile(path.join(root, "index.html"), await readFile(new URL("../deploy/hosted.index.html", import.meta.url)));
  await writeFile(path.join(root, "nginx.conf"), "worker_processes 1;\npid /tmp/nginx.pid;\nevents { worker_connections 1024; }\nhttp {\n include /etc/nginx/mime.types;\n client_body_temp_path /tmp/client_temp;\n proxy_temp_path /tmp/proxy_temp;\n fastcgi_temp_path /tmp/fastcgi_temp;\n uwsgi_temp_path /tmp/uwsgi_temp;\n scgi_temp_path /tmp/scgi_temp;\n include /etc/nginx/conf.d/default.conf;\n}\n");
  await writeFile(path.join(root, "Dockerfile"), "FROM " + nginx + "\nCOPY nginx.conf /etc/nginx/nginx.conf\nCOPY site.conf /etc/nginx/conf.d/default.conf\nCOPY index.html /var/www/ipgeolocation-mcp/index.html\nCOPY --chown=101:101 fullchain.pem privkey.pem /etc/letsencrypt/live/127.0.0.1/\nUSER 101:101\nENTRYPOINT [\"nginx\", \"-g\", \"daemon off;\"]\n");
  docker(["buildx", "build", "--load", "--tag", proxyImage, root]);
  docker(["run", "--detach", "--name", app, "--network", network, "--network-alias", "mcp", "--ip", "172.30.99.2",
    "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--pids-limit", "128", "--memory", "1g",
    "--entrypoint", "node",
    "--env", "IPGEOLOCATION_MCP_HTTP_HOST=0.0.0.0",
    "--env", "IPGEOLOCATION_MCP_PUBLIC_URL=" + url.href,
    "--env", "IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS=10000",
    "--env", "IPGEOLOCATION_MCP_TRUSTED_PROXIES=172.30.99.3",
    image, "/app/dist/http-cli.js"]);
  docker(["run", "--detach", "--name", proxy, "--network", network, "--ip", "172.30.99.3",
    "--publish", "127.0.0.1:" + assigned + ":8443", "--read-only", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true", "--tmpfs", "/tmp:rw,noexec,nosuid,size=128m", proxyImage]);
  const ca = await readFile(path.join(root, "ca.pem"));
  const request = (pathname, { method = "GET", headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = https.request(new URL(pathname, url), { ca, servername: "mcp.test", method, headers, timeout: 10000 }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("TLS fixture timeout")));
    req.end(body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body));
  });
  let healthy = false;
  let healthFailure = "";
  for (let i = 0; i < 200 && !healthy; i++) {
    try { const response = await request("/health"); healthy = response.status === 200; healthFailure = response.status + " " + response.text; }
    catch (error) { healthFailure = error.message; }
    if (!healthy) await delay(50);
  }
  assert.ok(healthy, "HTTPS health check must succeed with CA verification enabled: " + healthFailure + "\n" + docker(["logs", app]) + "\n" + docker(["logs", proxy]));
  const homepage = await request("/");
  assert.equal(homepage.status, 200);
  assert.match(homepage.headers["content-type"], /^text\/html/);
  assert.match(homepage.headers["cache-control"], /no-store/);
  assert.match(homepage.text, /https:\/\/mcp\.ipgeolocation\.io\/mcp/);
  assert.match(homepage.text, /X-IPGeolocation-API-Key/);
  assert.match(homepage.text, /https:\/\/app\.ipgeolocation\.io\/signup/);
  for (const tag of ["style", "script"]) {
    const blocks = [...homepage.text.matchAll(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">", "g"))];
    assert.equal(blocks.length, 1);
    const hash = createHash("sha256").update(blocks[0][1]).digest("base64");
    assert.ok(homepage.headers["content-security-policy"].includes("'sha256-" + hash + "'"), tag + " must match the actual CSP hash");
  }
  assert.ok(!/unsafe-inline|unsafe-eval/.test(homepage.headers["content-security-policy"]));
  assert.equal(homepage.headers["x-content-type-options"], "nosniff");
  assert.equal(homepage.headers["x-frame-options"], "DENY");
  assert.equal(homepage.headers["referrer-policy"], "no-referrer");
  assert.equal((await request("/", { method: "HEAD" })).text, "");
  assert.equal((await request("/", { method: "POST", body: {} })).status, 405);
  assert.equal((await request("/index.html")).status, 404);
  assert.equal((await request("/.env")).status, 404);
  assert.equal((await request("/mcp")).status, 405);
  const health = await request("/health", { headers: { "X-Real-IP": "198.51.100.10", "X-Forwarded-For": "198.51.100.11" } });
  assert.equal(health.status, 200);
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "X-IPGeolocation-API-Key": key };
  const init = await request("/mcp", { method: "POST", headers, body: { jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "tls-proxy-test", version: "1" } } } });
  assert.equal(init.status, 200);
  assert.ok(init.headers["mcp-session-id"]);
  const sessionHeaders = { ...headers, "Mcp-Session-Id": init.headers["mcp-session-id"], "Mcp-Protocol-Version": "2025-11-25" };
  const tools = await request("/mcp", { method: "POST", headers: sessionHeaders, body: { jsonrpc: "2.0", id: 2, method: "tools/list" } });
  assert.equal(JSON.parse(tools.text).result.tools.length, 16);
  assert.ok(!JSON.parse(tools.text).result.tools.some(tool => tool.name === "get_my_ip"));
  const stolen = await request("/mcp", { method: "POST", headers: {
    ...sessionHeaders, "X-IPGeolocation-API-Key": "synthetic-tls-other-key", "X-Real-IP": "203.0.113.1", "CF-Connecting-IP": "198.51.100.1",
  }, body: { jsonrpc: "2.0", id: 6, method: "tools/list" } });
  assert.equal(stolen.status, 404, "forwarded metadata cannot authorize another key's connection");
  assert.equal((await request("/mcp", { method: "POST", headers: { ...headers, "X-IPGeolocation-API-Key": "" }, body: {} })).status, 401);
  for (const duplicates of [[key, key], [key, "synthetic-other-connection-key"]]) {
    const rejected = await request("/mcp", { method: "POST", headers: { ...headers, "X-IPGeolocation-API-Key": duplicates }, body: {
      jsonrpc: "2.0", id: 3, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "duplicate-header-test", version: "1" } },
    } });
    const error = JSON.parse(rejected.text).error;
    assert.ok((rejected.status === 401 && error === "api_key_required") ||
      (rejected.status === 400 && error === "duplicate_header"), "duplicate key headers require an explicit authentication/header rejection");
  }
  assert.equal((await request("/mcp", { method: "POST", headers: { ...headers, Host: "untrusted.example" }, body: {} })).status, 421);
  assert.equal((await request("/mcp?apiKey=" + key, { method: "POST", headers, body: {} })).status, 400);
  const held = [];
  t.after(() => held.forEach(req => req.destroy()));
  for (let i = 0; i < 34; i++) {
    const bytes = i < 2 ? 25_000_000 : 1000;
    const req = https.request(url, { ca, servername: "mcp.test", method: "POST", headers: {
      ...sessionHeaders, "Content-Length": String(bytes),
    } }, res => res.resume());
    req.on("error", () => {});
    req.write(i < 2 ? Buffer.alloc(bytes - 1, 0x20) : "{");
    held.push(req);
  }
  await delay(150);
  const duringUpload = await request("/mcp", { method: "POST", headers: sessionHeaders, body: { jsonrpc: "2.0", id: 4, method: "tools/list" } });
  assert.equal(duringUpload.status, 200, "two large and32 tiny slow uploads leave normal requests available");
  assert.equal(JSON.parse(duringUpload.text).result.tools.length, 16);
  held.forEach(req => req.destroy());
  await delay(100);
  const large = '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"parse_user_agent","arguments":{"unexpected":true,"uaString":"' +
    "\\u0078".repeat(4 * 1024 * 1024 - 1024) + '"}}}';
  const largeReply = await request("/mcp", { method: "POST", headers: sessionHeaders, body: large });
  assert.equal(largeReply.status, 200, "a near-limit body survives the bounded Nginx temp filesystem");
  assert.equal(JSON.parse(largeReply.text).result.structuredContent.error.category, "validation", "local validation prevents a paid provider call");
  if (process.env.IPGEOLOCATION_LIVE_FREE_KEY && process.env.IPGEOLOCATION_LIVE_PAID_KEY) {
    await t.test("supplied free and paid keys complete every live tool through HTTPS and Nginx", () => {
      const result = spawnSync(process.execPath, ["tests/hosted.live.mjs"], {
        env: { ...process.env, NODE_EXTRA_CA_CERTS: path.join(root, "ca.pem"), IPGEOLOCATION_LIVE_MCP_URL: url.href },
        encoding: "utf8", timeout: 180000,
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /"passed":true/);
      assert.match(result.stdout, /"cachedPageReads":[1-9]/);
    });
  }
  const appLogs = docker(["logs", app]), proxyLogs = docker(["logs", proxy]);
  const entries = logs => logs.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line));
  const healthId = health.headers["x-request-id"];
  const appHealth = entries(appLogs).find(entry => entry.request_id === healthId);
  const proxyHealth = entries(proxyLogs).find(entry => entry.request_id === healthId);
  assert.ok(appHealth && proxyHealth, "both servers must log the same health request");
  assert.equal(appHealth.client_ip, proxyHealth.client_ip, "health logs must preserve the verified proxy client IP");
  assert.notEqual(appHealth.client_ip, "198.51.100.10", "health logs must ignore caller-supplied IP claims");
  assert.equal(appHealth.peer_ip, "172.30.99.3");
  const logs = appLogs + proxyLogs;
  for (const secret of [key, process.env.IPGEOLOCATION_LIVE_FREE_KEY, process.env.IPGEOLOCATION_LIVE_PAID_KEY].filter(Boolean)) {
    assert.ok(!logs.includes(secret), "proxy or runtime logs exposed a credential");
  }
  await request("/mcp", { method: "DELETE", headers: sessionHeaders });
  const began = performance.now();
  docker(["stop", "--time", "10", app]);
  assert.ok(performance.now() - began < 10000);
  const state = JSON.parse(docker(["inspect", app]))[0];
  assert.equal(state.State.ExitCode, 0);
  assert.equal(state.State.OOMKilled, false);
});

test("shipped Compose works through host Nginx without customer quotas or forwarding-based identity", { timeout: 300000 }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), "ipgeo-hosted-compose-"));
  const id = randomUUID().slice(0, 8);
  const project = "ipgeo-hosted-path-" + id;
  const proxy = project + "-proxy";
  const proxyImage = "ipgeo-hosted-nginx-qa:" + id;
  const compose = ["compose", "--project-name", project, "--file", path.join(root, "compose.yml")];
  const clients = [];
  t.after(async () => {
    for (const name of [proxy, ...clients]) { try { docker(["rm", "--force", name]); } catch {} }
    try { docker([...compose, "down", "--volumes", "--remove-orphans"]); } catch {}
    try { docker(["image", "rm", proxyImage]); } catch {}
    await rm(root, { recursive: true, force: true });
  });
  const port = Number(docker(["run", "--rm", "--network", "host", "--entrypoint", "node", image, "-e",
    "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close();});"]));
  assert.ok(Number.isInteger(port) && port > 1024);
  openssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=IPGeo temporary Compose test CA",
    "-keyout", path.join(root, "ca.key"), "-out", path.join(root, "ca.pem")]);
  openssl(["req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=mcp.test",
    "-keyout", path.join(root, "privkey.pem"), "-out", path.join(root, "server.csr")]);
  await writeFile(path.join(root, "extensions.cnf"), "subjectAltName=IP:127.0.0.1,DNS:mcp.test\nextendedKeyUsage=serverAuth\n");
  openssl(["x509", "-req", "-in", path.join(root, "server.csr"), "-CA", path.join(root, "ca.pem"),
    "-CAkey", path.join(root, "ca.key"), "-CAcreateserial", "-days", "1",
    "-extfile", path.join(root, "extensions.cnf"), "-out", path.join(root, "fullchain.pem")]);
  const authority = "mcp.test:" + port;
  let composeFile = await readFile(new URL("../deploy/hosted.compose.yml", import.meta.url), "utf8");
  composeFile = composeFile.replace("ipgeolocation-io-mcp:hosted-candidate", image);
  await writeFile(path.join(root, "compose.yml"), composeFile);
  const env = (await readFile(new URL("../deploy/hosted.env.example", import.meta.url), "utf8"))
    .replace("https://mcp.ipgeolocation.io/mcp", "https://" + authority + "/mcp");
  await writeFile(path.join(root, "hosted.env"), env, { mode: 0o600 });
  let site = await readFile(new URL("../deploy/hosted.nginx.conf", import.meta.url), "utf8");
  site = site.replaceAll("mcp.ipgeolocation.io", "mcp.test")
    .replace("listen 443 ssl;", "listen 127.0.0.1:" + port + " ssl;")
    .replaceAll("proxy_set_header Host mcp.test;", "proxy_set_header Host " + authority + ";")
    .replace("/var/log/nginx/mcp.access.log", "/dev/stdout")
    .replace("/var/cache/nginx/mcp_body", "/tmp/client_temp");
  await writeFile(path.join(root, "site.conf"), site);
  await writeFile(path.join(root, "index.html"), await readFile(new URL("../deploy/hosted.index.html", import.meta.url)));
  await writeFile(path.join(root, "nginx.conf"), "worker_processes 1;\npid /tmp/nginx.pid;\nevents { worker_connections 1024; }\nhttp {\n include /etc/nginx/mime.types;\n client_body_temp_path /tmp/client_temp;\n proxy_temp_path /tmp/proxy_temp;\n fastcgi_temp_path /tmp/fastcgi_temp;\n uwsgi_temp_path /tmp/uwsgi_temp;\n scgi_temp_path /tmp/scgi_temp;\n include /etc/nginx/conf.d/default.conf;\n}\n");
  await writeFile(path.join(root, "Dockerfile"), "FROM " + nginx + "\nCOPY nginx.conf /etc/nginx/nginx.conf\nCOPY site.conf /etc/nginx/conf.d/default.conf\nCOPY index.html /var/www/ipgeolocation-mcp/index.html\nCOPY --chown=101:101 fullchain.pem privkey.pem /etc/letsencrypt/live/mcp.test/\nUSER 101:101\nENTRYPOINT [\"nginx\", \"-g\", \"daemon off;\"]\n");
  docker(["buildx", "build", "--load", "--tag", proxyImage, root]);
  docker([...compose, "up", "--detach", "--no-build"]);
  const app = docker([...compose, "ps", "--quiet", "mcp"]);
  assert.ok(app);
  docker(["run", "--detach", "--name", proxy, "--network", "host", "--read-only", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true", "--tmpfs", "/tmp:rw,noexec,nosuid,size=128m", proxyImage]);
  const ca = (await readFile(path.join(root, "ca.pem"))).toString("base64");
  const runClient = (network, code, args = []) => {
    const name = project + "-client-" + clients.length;
    clients.push(name);
    return JSON.parse(docker(["run", "--rm", "--name", name, "--network", network, ...args,
      "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--entrypoint", "node", image,
      "--input-type=module", "-e", code]));
  };
  const hostResult = runClient("host", `
    import https from 'node:https';
    import {setTimeout as delay} from 'node:timers/promises';
    const request=(source,key,extra={},path='/mcp')=>new Promise((resolve,reject)=>{
      const req=https.request({hostname:'127.0.0.1',port:${port},servername:'mcp.test',
        ca:Buffer.from('${ca}','base64'),localAddress:source,method:path==='/health'?'GET':'POST',path,timeout:2000,
        headers:{Host:'${authority}','Content-Type':'application/json',Accept:'application/json, text/event-stream',
          'X-IPGeolocation-API-Key':key,...extra}},res=>{
        res.resume();res.on('end',()=>resolve(res.statusCode));res.on('error',reject);
      });
      req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('Compose HTTPS request timeout')));
      req.end(path==='/health'?undefined:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'compose-path-test',version:'1'}}}));
    });
    const deadline=Date.now()+10000;let healthy=false;
    while(!healthy&&Date.now()<deadline){try{healthy=await request('127.0.0.2','synthetic-health',{},'/health')===200;}catch{}if(!healthy)await delay(50);}
    if(!healthy)throw Error('Compose HTTPS health check failed');
    const first=await request('127.0.0.2','synthetic-compose-first');
    const forged=await request('127.0.0.2','synthetic-compose-forged',{'X-Real-IP':'198.51.100.10','X-Forwarded-For':'198.51.100.11','CF-Connecting-IP':'198.51.100.12'});
    const other=await request('127.0.0.3','synthetic-compose-other');
    console.log(JSON.stringify({first,forged,other}));
  `);
  assert.deepEqual(hostResult, { first: 200, forged: 200, other: 200 });
  const directResult = runClient(project + "_mcp", `
    import http from 'node:http';
    const request=(key,source)=>new Promise((resolve,reject)=>{
      const req=http.request({hostname:'mcp',port:8787,path:'/mcp',method:'POST',timeout:2000,
        headers:{Host:'${authority}','Content-Type':'application/json',Accept:'application/json, text/event-stream','X-IPGeolocation-API-Key':key,'X-Real-IP':source}},res=>{
        res.resume();res.on('end',()=>resolve(res.statusCode));res.on('error',reject);
      });
      req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('Untrusted bridge request timeout')));
      req.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'untrusted-bridge-test',version:'1'}}}));
    });
    const first=await request('synthetic-bridge-first','198.51.100.10');
    const forged=await request('synthetic-bridge-forged','198.51.100.20');
    console.log(JSON.stringify({first,forged}));
  `, ["--ip", "172.30.88.3"]);
  assert.deepEqual(directResult, { first: 200, forged: 200 });
  const logs = docker(["logs", app]) + docker(["logs", proxy]);
  for (const value of ["synthetic-compose-first", "synthetic-compose-forged", "synthetic-compose-other", "synthetic-bridge-first", "synthetic-bridge-forged"]) {
    assert.ok(!logs.includes(value), "proxy or application logs exposed a connection key");
  }
});
