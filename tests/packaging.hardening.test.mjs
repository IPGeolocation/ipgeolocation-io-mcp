import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { fixtureArchive } from "./fixtures/archive.fixture.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const bundleName = "@ipgeolocation/ipgeolocation-io-mcp";
const version = "2.0.2";
const filename = `ipgeolocation-ipgeolocation-io-mcp-${version}.mcpb`;
const tag = `v${version}`;
const sourceDigest = "a".repeat(40);
const onReleasePlatform = (name, handler) => test(name, {
  skip: process.platform === "win32" ? "The release job uses POSIX tools on Linux." : false,
}, handler);

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "packaging-hardening-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = path.join(root, "repository with spaces %20");
  await mkdir(path.join(repository, "scripts"), { recursive: true });
  await mkdir(path.join(repository, "packaging/mpak"), { recursive: true });
  for (const file of ["prepare-mpak-package.mjs", "generate-mpak-sbom.mjs", "upload-mpak-release-assets.mjs", "prepare-mpak-announcement.mjs", "finalize-mpak-bundle.mjs"]) {
    await cp(path.join(repo, "scripts", file), path.join(repository, "scripts", file));
  }
  const metadata = {
    "package.json": { name: "fixture", version, type: "module", license: "MIT", dependencies: {} },
    "package-lock.json": { name: "fixture", version, lockfileVersion: 3, packages: { "": { name: "fixture", version, dependencies: {} } } },
    "manifest.json": { name: bundleName, version },
    "server.json": { name: bundleName, version },
    "packaging/mpak/config.json": { bundleName },
  };
  for (const [name, value] of Object.entries(metadata)) await writeFile(path.join(repository, name), JSON.stringify(value));
  for (const name of ["README.md", "REFERENCE.md", "CHANGELOG.md", "SECURITY.md", "CONTRIBUTING.md", "RELEASING.md", "LICENSE", "packaging/mpak/README.md", "packaging/kiro/README.md", "packaging/kiro/mcp.json", "packaging/kiro/plugin.json"]) {
    await mkdir(path.dirname(path.join(repository, name)), { recursive: true });
    await writeFile(path.join(repository, name), `Fixture ${name}\n`);
  }
  await mkdir(path.join(repository, "dist"));
  await writeFile(path.join(repository, "dist/cli.js"), "// Fixture runtime\n");
  const staging = path.join(repository, "artifacts/package with spaces");
  await mkdir(staging, { recursive: true });
  await writeFile(path.join(staging, "manifest.json"), JSON.stringify({ name: bundleName, version }));
  const childEnv = { ...process.env };
  for (const name of Object.keys(childEnv)) if (/IPGEOLOCATION|TOKEN|SECRET|API_KEY/i.test(name)) delete childEnv[name];
  return {
    root, repository, staging, env: childEnv,
    run: (script, args = [], env = {}) => {
      const result = spawnSync(process.execPath, [path.join(repository, "scripts", script), ...args], {
        cwd: repository, env: { ...childEnv, ...env }, encoding: "utf8", timeout: 30000,
      });
      assert.ifError(result.error);
      assert.equal(result.signal, null, `${script} stopped by ${result.signal}`);
      return result;
    },
  };
}

test("npm packing rebuilds dist without stale code or stray credential files", async t => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "npm-clean-build-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = path.join(root, "repository with spaces");
  await mkdir(repository);
  for (const name of ["package.json", "REFERENCE.md", "tsconfig.json", "src"]) {
    await cp(path.join(repo, name), path.join(repository, name), { recursive: true });
  }
  await symlink(await realpath(path.join(repo, "node_modules")), path.join(repository, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const strayFiles = ["dist/tools/removed-old-tool.js", "dist/scratch/.env.local"];
  for (const name of strayFiles) {
    await mkdir(path.dirname(path.join(repository, name)), { recursive: true });
    await writeFile(path.join(repository, name), "synthetic stray-file marker\n");
  }
  const npmCli = process.env.npm_execpath || path.resolve(path.dirname(process.execPath), process.platform === "win32"
    ? "node_modules/npm/bin/npm-cli.js" : "../lib/node_modules/npm/bin/npm-cli.js");
  const userNpmrc = path.join(root, "user.npmrc"), globalNpmrc = path.join(root, "global.npmrc");
  await writeFile(userNpmrc, "");
  await writeFile(globalNpmrc, "");
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/IPGEOLOCATION|TOKEN|SECRET|API_KEY|^npm_config_/i.test(name)) delete env[name];
  Object.assign(env, {
    PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`,
    NPM_CONFIG_USERCONFIG: userNpmrc, NPM_CONFIG_GLOBALCONFIG: globalNpmrc,
    NPM_CONFIG_CACHE: path.join(root, "npm-cache"), NPM_CONFIG_UPDATE_NOTIFIER: "false",
    NPM_CONFIG_AUDIT: "false", NPM_CONFIG_FUND: "false",
  });
  const result = spawnSync(process.execPath, [npmCli, "pack", "--dry-run", "--json", "--offline"], {
    cwd: repository, env, encoding: "utf8", timeout: 60000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const [packed] = JSON.parse(result.stdout.slice(result.stdout.indexOf("[")));
  const files = new Set(packed.files.map(file => file.path));
  assert.ok(files.has("dist/cli.js"));
  assert.ok(files.has("dist/index.js"));
  assert.ok(files.has("REFERENCE.md"));
  for (const name of strayFiles) {
    assert.equal(files.has(name), false, `${name} must not enter the package`);
    await assert.rejects(readFile(path.join(repository, name)), { code: "ENOENT" });
  }
});

for (const rootLink of [false, true]) {
  test(`dependency pruning preserves outside data through ${rootLink ? "a node_modules junction" : "nested symlinks or junctions"}`, async t => {
    const f = await fixture(t);
    const outside = path.join(f.root, "outside-staging");
    await mkdir(path.join(outside, "docs"), { recursive: true });
    await writeFile(path.join(outside, "docs/sentinel.txt"), "protected outside documentation");
    await writeFile(path.join(outside, "README.md"), "protected outside README");
    const npmCli = path.join(f.root, "npm fixture.mjs");
    await writeFile(npmCli, `import {mkdir,writeFile,symlink} from 'node:fs/promises'; import path from 'node:path';
if(process.argv[2]==='run'){await mkdir('dist',{recursive:true});await writeFile('dist/cli.js','// fresh fixture runtime');process.exit(0);}
const modules=path.join(process.cwd(),'node_modules'), outside=process.env.FIXTURE_OUTSIDE, kind=process.platform==='win32'?'junction':'dir';
if(process.env.FIXTURE_ROOT_LINK==='1') await symlink(outside,modules,kind);
else {const pkg=path.join(modules,'fixture');await mkdir(path.join(pkg,'docs'),{recursive:true});await writeFile(path.join(pkg,'docs/remove.txt'),'remove');await writeFile(path.join(pkg,'README.md'),'remove');await writeFile(path.join(pkg,'LICENSE'),'keep license');await writeFile(path.join(pkg,'index.js'),'keep runtime');await symlink(outside,path.join(pkg,'linked'),kind);}
`);
    const result = f.run("prepare-mpak-package.mjs", [], {
      npm_execpath: npmCli, MPAK_STAGING_DIR: f.staging,
      FIXTURE_OUTSIDE: outside, FIXTURE_ROOT_LINK: rootLink ? "1" : "0",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(path.join(outside, "docs/sentinel.txt"), "utf8"), "protected outside documentation");
    assert.equal(await readFile(path.join(outside, "README.md"), "utf8"), "protected outside README");
    const modules = path.join(f.staging, "node_modules");
    assert.equal((await lstat(rootLink ? modules : path.join(modules, "fixture/linked"))).isSymbolicLink(), true);
    if (!rootLink) {
      assert.equal(await readFile(path.join(modules, "fixture/LICENSE"), "utf8"), "keep license");
      assert.equal(await readFile(path.join(modules, "fixture/index.js"), "utf8"), "keep runtime");
      await assert.rejects(readFile(path.join(modules, "fixture/docs/remove.txt")), { code: "ENOENT" });
      await assert.rejects(readFile(path.join(modules, "fixture/README.md")), { code: "ENOENT" });
    }
  });
}

async function sbomFixture(t, mode) {
  const f = await fixture(t);
  const preload = path.join(f.root, "syft fixture.mjs");
  await writeFile(preload, `import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';
if(process.argv.includes('--source-name')&&process.argv.includes('--output')){
 const output=process.argv[process.argv.indexOf('--output')+1].slice('cyclonedx-json='.length),mode=process.env.FIXTURE_SYFT_MODE,root=process.env.FIXTURE_REPOSITORY;
 const sbom={bomFormat:'CycloneDX',specVersion:'1.6',components:[{type:'library',name:'fixture',version:'1',purl:'pkg:npm/fixture@1'}],metadata:{note:'node_modules/fixture/index.js'}};
 if(mode==='backslash')sbom.metadata.note=root.replaceAll('/','\\\\');
 if(mode==='forward')sbom.metadata.note=root.replaceAll('\\\\','/');
 if(mode==='file-url')sbom.metadata.note=pathToFileURL(root).href;
 if(mode==='key')sbom.metadata[root]='private key name';
 if(mode==='dot-exit')sbom.metadata.note=root+path.sep+'..'+path.sep+'outside';
 if(mode==='dot-enter')sbom.metadata.note=path.dirname(root)+path.sep+'intermediate'+path.sep+'..'+path.sep+path.basename(root);
 if(mode==='case')sbom.metadata.note=root.toUpperCase();
 if(mode==='shape')sbom.bomFormat='invalid';
 if(mode==='version')sbom.specVersion='2.0';
 if(mode==='empty')sbom.components=[];
 if(mode==='purl')delete sbom.components[0].purl;
 fs.writeFileSync(output,mode==='bad-json'?'{"private":':JSON.stringify(sbom));
 process.exit(mode==='scanner-failure'?11:0);
}
`);
  await writeFile(path.join(f.staging, "sbom.cdx.json"), "old SBOM must not survive a failed scan");
  return {
    ...f,
    generate: () => f.run("generate-mpak-sbom.mjs", [f.staging], {
      SYFT_BIN: process.execPath, NODE_OPTIONS: [f.env.NODE_OPTIONS, `--import=${pathToFileURL(preload).href}`].filter(Boolean).join(" "),
      FIXTURE_SYFT_MODE: mode, FIXTURE_REPOSITORY: f.repository,
    }),
  };
}

test("validated SBOM output is retained without leaving raw scanner files", async t => {
  const f = await sbomFixture(t, "valid");
  const result = f.generate();
  assert.equal(result.status, 0, result.stderr);
  const sbom = JSON.parse(await readFile(path.join(f.staging, "sbom.cdx.json"), "utf8"));
  assert.equal(sbom.metadata.component.name, bundleName);
  assert.equal(sbom.specVersion, "1.6");
  assert.deepEqual((await readdir(f.staging)).filter(name => name.startsWith(".sbom-")), []);
});

for (const mode of ["backslash", "forward", "file-url", "key", "dot-exit", "dot-enter", "scanner-failure", "bad-json", "shape", "version", "empty", "purl", ...(process.platform === "win32" ? ["case"] : [])]) {
  test(`rejected SBOM ${mode} leaves no final or raw scanner artifact`, async t => {
    const f = await sbomFixture(t, mode);
    const result = f.generate();
    assert.notEqual(result.status, 0);
    if (["backslash", "forward", "file-url", "key", "dot-exit", "dot-enter", "case"].includes(mode)) assert.match(result.stderr, /absolute workspace path/);
    await assert.rejects(readFile(path.join(f.staging, "sbom.cdx.json")), { code: "ENOENT" });
    assert.deepEqual((await readdir(f.staging)).filter(name => name.startsWith(".sbom-")), []);
  });
}


async function announcementFixture(t, manifest = { name: bundleName, version }) {
  const f = await fixture(t);
  const bin = path.join(f.root, "bin"), published = path.join(f.root, "published"), local = path.join(f.root, "local assets %20");
  await Promise.all([bin, published, local].map(directory => mkdir(directory)));
  const log = path.join(f.root, "calls.jsonl"), metadata = path.join(f.root, "release.json"), runMetadata = path.join(f.root, "run.json");
  await writeFile(metadata, JSON.stringify({ tag_name: tag, draft: false, prerelease: false, assets: [] }));
  await writeFile(runMetadata, JSON.stringify({ id: 123, repository: { full_name: "IPGeolocation/ipgeolocation-io-mcp" }, head_sha: sourceDigest, head_branch: tag, path: ".github/workflows/mpak-release.yml", event: "workflow_dispatch", status: "completed" }));
  const assets = [filename, `${filename}.sigstore.json`, `${filename}.provenance.sigstore.json`, "server.json", "sbom.cdx.json"];
  const embedded = { "manifest.json": JSON.stringify(manifest), "server.json": JSON.stringify({ fixture: "server.json" }), "sbom.cdx.json": JSON.stringify({ fixture: "sbom.cdx.json" }) };
  await Promise.all(assets.map(name => writeFile(path.join(local, name), name === filename ? fixtureArchive(embedded) : JSON.stringify({ fixture: name }))));
  await writeFile(path.join(bin, "gh"), `#!${process.execPath}\n` + `
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),args=process.argv.slice(2);
fs.appendFileSync(process.env.FIXTURE_CALLS,JSON.stringify({command:'gh',args})+'\\n');
const read=()=>JSON.parse(fs.readFileSync(process.env.FIXTURE_RELEASE,'utf8'));
if(args[0]==='api') {
 const commit=args[1].endsWith('/commits/refs%2Ftags%2F'+process.env.SOURCE_REF)?process.env.FIXTURE_COMMIT:process.env.FIXTURE_BRANCH_COMMIT||process.env.FIXTURE_COMMIT;
 process.stdout.write(JSON.stringify(args[1].includes('/commits/')?{sha:commit}:args[1].includes('/actions/runs/')?JSON.parse(fs.readFileSync(process.env.FIXTURE_RUN,'utf8')):read()));
}
else if(args[0]==='release'&&args[1]==='view')process.stdout.write(JSON.stringify(read()));
else if(args[0]==='release'&&args[1]==='upload'){
 const release=read(),file=args[3],name=path.basename(file);
 if(process.env.FIXTURE_UPLOAD_FAIL===name&&!process.env.FIXTURE_FAIL_AFTER_UPLOAD)process.exit(23);
 if(release.assets.some(asset=>asset.name===name))process.exit(24);
 const data=fs.readFileSync(file);fs.copyFileSync(file,path.join(process.env.FIXTURE_PUBLISHED,name));release.assets.push({name,size:data.length,digest:'sha256:'+crypto.createHash('sha256').update(data).digest('hex'),state:'uploaded'});fs.writeFileSync(process.env.FIXTURE_RELEASE,JSON.stringify(release));
 if(process.env.FIXTURE_UPLOAD_FAIL===name)process.exit(23);
} else if(args[0]==='release'&&args[1]==='download'){
 const destination=args[args.indexOf('--dir')+1];for(let i=0;i<args.length;i++)if(args[i]==='--pattern'){const name=args[++i],data=fs.readFileSync(path.join(process.env.FIXTURE_PUBLISHED,name));if(process.env.FIXTURE_CORRUPT===name)data[0]^=1;fs.writeFileSync(path.join(destination,name),data);}
} else if(args[0]==='run'&&args[1]==='download'){
 if(process.env.FIXTURE_EXPIRED)process.exit(25);
 const destination=args[args.indexOf('--dir')+1];for(const name of fs.readdirSync(process.env.FIXTURE_RETAINED)){if(process.env.FIXTURE_MISSING===name)continue;fs.copyFileSync(path.join(process.env.FIXTURE_RETAINED,name),path.join(destination,name));}
} else if(args[0]==='attestation'&&args[1]==='verify'){process.exitCode=process.env.FIXTURE_BAD_PROVENANCE?23:0;}
else process.exitCode=91;
`, { mode: 0o755 });
  await writeFile(path.join(bin, "cosign"), `#!${process.execPath}\n` + `
const fs=require('node:fs'),args=process.argv.slice(2);fs.appendFileSync(process.env.FIXTURE_CALLS,JSON.stringify({command:'cosign',args})+'\\n');process.exitCode=args[0]!=='verify-blob'||process.env.FIXTURE_BAD_SIGNATURE?23:0;
`, { mode: 0o755 });
  await writeFile(path.join(bin, "curl"), `#!${process.execPath}\n` + `
const fs=require('node:fs'),args=process.argv.slice(2),post=args.includes('POST');
if(!post){fs.appendFileSync(process.env.FIXTURE_CALLS,JSON.stringify({command:'curl',kind:'oidc'})+'\\n');process.stdout.write(JSON.stringify({value:'fixture-oidc-token'}));}
else {const body=JSON.parse(fs.readFileSync(args[args.indexOf('--data-binary')+1].slice(1),'utf8'));fs.appendFileSync(process.env.FIXTURE_CALLS,JSON.stringify({command:'curl',kind:'announce',payload:body})+'\\n');process.stdout.write(JSON.stringify({message:'Fixture response'})+'\\n'+(process.env.FIXTURE_ANNOUNCE_FAIL?'503':'200'));}
`, { mode: 0o755 });
  await writeFile(path.join(bin, "jq"), `#!${process.execPath}\n` + `
const fs=require('node:fs'),args=process.argv.slice(2),index=args[0]==='-r'?1:0,query=args[index],file=args[index+1],value=JSON.parse(fs.readFileSync(file||0,'utf8'));process.stdout.write((query==='.'?JSON.stringify(value):String(value[query.slice(1)]))+'\\n');
`, { mode: 0o755 });
  const env = {
    ...f.env, PATH: `${bin}${path.delimiter}${f.env.PATH}`,
    GITHUB_REPOSITORY: "IPGeolocation/ipgeolocation-io-mcp", GITHUB_REF: `refs/tags/${tag}`, GITHUB_SHA: sourceDigest, SOURCE_REF: tag,
    FIXTURE_CALLS: log, FIXTURE_RELEASE: metadata, FIXTURE_COMMIT: sourceDigest, FIXTURE_PUBLISHED: published,
    FIXTURE_RUN: runMetadata, FIXTURE_RETAINED: local,
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "fixture-action-token", ACTIONS_ID_TOKEN_REQUEST_URL: "https://example.test/oidc?fixture=1",
  };
  return {
    ...f, env, assets, local, published, metadata, runMetadata,
    upload: (extra = {}) => f.run("upload-mpak-release-assets.mjs", [tag, ...assets.map(name => path.join(local, name))], { ...env, ...extra }),
    preflight: (extra = {}) => f.run("upload-mpak-release-assets.mjs", ["--preflight", tag], { ...env, ...extra }),
    restore: (output, extra = {}, runId = "123") => f.run("prepare-mpak-announcement.mjs", ["--restore", tag, runId, output], { ...env, ...extra }),
    resume: (directory = local, extra = {}) => f.run("upload-mpak-release-assets.mjs", ["--resume", tag, directory], { ...env, ...extra }),
    prepare: (output, extra = {}, inputTag = tag) => f.run("prepare-mpak-announcement.mjs", [inputTag, output], { ...env, ...extra }),
    announce: async (runnerTemp, extra = {}) => {
      const workflow = await readFile(path.join(repo, ".github/workflows/mpak-release.yml"), "utf8");
      const block = workflow.split("      - name: Announce universal mpak bundle\n        run: |\n")[1];
      assert.ok(block, "The actual announce step must remain independently executable");
      const script = block.split("\n").map(line => line.startsWith("          ") ? line.slice(10) : line).join("\n");
      const shell = spawnSync("sh", ["-c", "set -o pipefail"]).status === 0 ? "sh" : "bash";
      return spawnSync(shell, ["-c", script], { env: { ...env, RUNNER_TEMP: runnerTemp, ...extra }, encoding: "utf8", timeout: 30000 });
    },
    calls: async () => { try { return (await readFile(log, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse); } catch (error) { if (error.code === "ENOENT") return []; throw error; } },
  };
}

async function seedPublishedAssets(f) {
  const release = JSON.parse(await readFile(f.metadata, "utf8"));
  for (const name of f.assets) {
    const data = await readFile(path.join(f.local, name));
    await writeFile(path.join(f.published, name), data);
    release.assets.push({ name, size: data.length, digest: `sha256:${createHash("sha256").update(data).digest("hex")}`, state: "uploaded" });
  }
  await writeFile(f.metadata, JSON.stringify(release));
}

test("announcement is a separate read-only job with no build, signing or immutable uploads", async () => {
  const workflow = (await readFile(path.join(repo, ".github/workflows/mpak-release.yml"), "utf8")).replace(/\r\n/g, "\n");
  const [publish, announce] = workflow.split("\n  announce:\n");
  assert.ok(announce);
  assert.match(announce, /needs: publish/);
  assert.match(announce, /contents: read\n      id-token: write/);
  assert.match(announce, /prepare-mpak-announcement\.mjs/);
  assert.doesNotMatch(announce, /sign-blob|upload-mpak-release-assets|mcpb-pack@|npm ci|npm test|contents: write/);
  assert.doesNotMatch(publish, /bundles\/announce|Announce universal/);
});

onReleasePlatform("failed announcement reruns from the same published assets without uploading or signing again", async t => {
  const f = await announcementFixture(t);
  assert.equal(f.upload().status, 0);
  const publishedBefore = await Promise.all(f.assets.map(async name => createHash("sha256").update(await readFile(path.join(f.published, name))).digest("hex")));
  const first = path.join(f.root, "first-job"), retry = path.join(f.root, "retried-job");
  await mkdir(first); await mkdir(retry);
  const initial = f.prepare(path.join(first, "mpak-announcement"));
  assert.equal(initial.status, 0, initial.stderr);
  assert.notEqual((await f.announce(first, { FIXTURE_ANNOUNCE_FAIL: "1" })).status, 0);
  const second = f.prepare(path.join(retry, "mpak-announcement"));
  assert.equal(second.status, 0, second.stderr);
  assert.equal((await f.announce(retry)).status, 0);
  const calls = await f.calls();
  assert.equal(calls.filter(call => call.command === "gh" && call.args[0] === "release" && call.args[1] === "upload").length, 5);
  assert.equal(calls.filter(call => call.command === "curl" && call.kind === "announce").length, 2);
  assert.ok(calls.filter(call => call.command === "cosign").every(call => call.args[0] === "verify-blob"));
  assert.deepEqual(await readFile(path.join(first, "mpak-announcement/announcement.json")), await readFile(path.join(retry, "mpak-announcement/announcement.json")));
  assert.deepEqual(await Promise.all(f.assets.map(async name => createHash("sha256").update(await readFile(path.join(f.published, name))).digest("hex"))), publishedBefore);
  const verification = calls.find(call => call.command === "gh" && call.args[0] === "attestation");
  assert.equal(verification.args[verification.args.indexOf("--source-ref") + 1], `refs/tags/${tag}`);
  assert.equal(verification.args[verification.args.indexOf("--source-digest") + 1], sourceDigest);
});

for (const manifest of [{ name: "@other/server", version }, { name: bundleName, version: "9.9.9" }]) {
  onReleasePlatform(`manifest mismatch is rejected before publication and after download: ${JSON.stringify(manifest)}`, async t => {
    const f = await announcementFixture(t, manifest);
    const upload = f.upload();
    assert.notEqual(upload.status, 0);
    assert.match(upload.stderr, /bundle manifest does not match/);
    assert.deepEqual(await f.calls(), []);
    await seedPublishedAssets(f);
    const output = path.join(f.root, "download");
    const result = f.prepare(output);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /bundle manifest does not match/);
    assert.equal(uploadCalls(await f.calls()).length, 0);
    await assert.rejects(readFile(path.join(output, "announcement.json")), { code: "ENOENT" });
  });
}

for (const [name, env, message] of [
  ["artifact bytes", { FIXTURE_CORRUPT: filename }, /checksum does not match/],
  ["tag commit", { FIXTURE_COMMIT: "b".repeat(40) }, /source commit/],
  ["signature", { FIXTURE_BAD_SIGNATURE: "1" }, /cosign failed/],
  ["provenance", { FIXTURE_BAD_PROVENANCE: "1" }, /gh failed/],
]) {
  onReleasePlatform(`announcement preparation rejects mismatched ${name}`, async t => {
    const f = await announcementFixture(t);
    assert.equal(f.upload().status, 0);
    const output = path.join(f.root, "download"), result = f.prepare(output, env);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
    await assert.rejects(readFile(path.join(output, "announcement.json")), { code: "ENOENT" });
    assert.equal((await f.calls()).filter(call => call.command === "curl").length, 0);
  });
}

for (const inputTag of ["--help", "v2.0.2/../../escape", "v2.0.2;echo", "v2.0.2$(echo)", "v2.0.2\n", "v2.0.2#label"]) {
  test(`unsafe release tag is rejected before commands or filesystem output: ${JSON.stringify(inputTag)}`, async t => {
    const f = await announcementFixture(t);
    const output = path.join(f.root, "download"), result = f.prepare(output, { GITHUB_REF: `refs/tags/${inputTag}`, SOURCE_REF: inputTag }, inputTag);
    assert.notEqual(result.status, 0);
    assert.deepEqual(await f.calls(), []);
    await assert.rejects(lstat(output), { code: "ENOENT" });
  });
}

onReleasePlatform("unexpected release filenames cannot select paths outside the new download directory", async t => {
  const f = await announcementFixture(t);
  assert.equal(f.upload().status, 0);
  const metadata = JSON.parse(await readFile(f.metadata, "utf8"));
  metadata.assets.find(asset => asset.name === filename).name = "../../escape.mcpb";
  await writeFile(f.metadata, JSON.stringify(metadata));
  const output = path.join(f.root, "download"), result = f.prepare(output);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Published asset metadata is missing or invalid/);
  await assert.rejects(lstat(output), { code: "ENOENT" });
  assert.equal((await f.calls()).filter(call => call.args?.includes("download")).length, 0);
});

for (const env of [
  { GITHUB_REF: "refs/heads/main" }, { SOURCE_REF: "v9.9.9" },
  { GITHUB_REPOSITORY: "IPGeolocation/repo;echo" }, { GITHUB_SHA: "not-a-commit" },
]) {
  test(`invalid announcement source context is rejected before any command: ${JSON.stringify(env)}`, async t => {
    const f = await announcementFixture(t);
    const result = f.prepare(path.join(f.root, "download"), env);
    assert.notEqual(result.status, 0);
    assert.deepEqual(await f.calls(), []);
  });
}

onReleasePlatform("unverifiable release checksums cannot produce an announcement payload", async t => {
  const f = await announcementFixture(t);
  assert.equal(f.upload().status, 0);
  const metadata = JSON.parse(await readFile(f.metadata, "utf8"));
  delete metadata.assets[0].digest;
  await writeFile(f.metadata, JSON.stringify(metadata));
  const result = f.prepare(path.join(f.root, "download"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Published asset metadata is missing or invalid/);
  assert.equal((await f.calls()).filter(call => call.args?.includes("download")).length, 0);
});

test("a scanner startup failure leaves no previous SBOM or raw output", async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.staging, "sbom.cdx.json"), "previous SBOM");
  const result = f.run("generate-mpak-sbom.mjs", [f.staging], { SYFT_BIN: path.join(f.root, "missing-scanner") });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unable to run Syft/);
  await assert.rejects(readFile(path.join(f.staging, "sbom.cdx.json")), { code: "ENOENT" });
  assert.deepEqual((await readdir(f.staging)).filter(name => name.startsWith(".sbom-")), []);
});

const uploadCalls = calls => calls.filter(call => call.command === "gh" && call.args[0] === "release" && call.args[1] === "upload");
const publicationOrder = [`${filename}.sigstore.json`, `${filename}.provenance.sigstore.json`, "sbom.cdx.json", "server.json", filename];

onReleasePlatform("every release path verifies the exact tag when a branch shares its name", async t => {
  for (const operation of ["preflight", "upload", "restore", "resume", "prepare"]) {
    await t.test(operation, async t => {
      const f = await announcementFixture(t);
      const extra = { FIXTURE_COMMIT: "b".repeat(40), FIXTURE_BRANCH_COMMIT: sourceDigest };
      const result = operation === "restore" || operation === "prepare"
        ? f[operation](path.join(f.root, "new-output"), extra)
        : operation === "resume" ? f.resume(f.local, extra) : f[operation](extra);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /release tag does not match this workflow's source commit/);
      assert.deepEqual(await f.calls(), [{ command: "gh", args: ["api", `repos/IPGeolocation/ipgeolocation-io-mcp/commits/refs%2Ftags%2F${tag}`] }]);
    });
  }
});

onReleasePlatform("early publication preflight stops on a partial release before signing or uploading", async t => {
  const f = await announcementFixture(t);
  assert.equal(f.preflight().status, 0);
  assert.deepEqual((await f.calls()).map(call => call.args[0]), ["api", "api"]);
  assert.equal(f.upload({ FIXTURE_UPLOAD_FAIL: publicationOrder[1] }).status, 23);
  const count = (await f.calls()).length, result = f.preflight();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Release assets already exist/);
  assert.deepEqual((await f.calls()).slice(count).map(call => call.args[0]), ["api", "api"]);
});

for (const failedAsset of publicationOrder) {
  for (const accepted of [false, true]) {
    onReleasePlatform(`interrupted upload ${accepted ? "after" : "before"} accepting ${failedAsset} resumes identical bytes`, async t => {
      const f = await announcementFixture(t);
      assert.equal(f.upload({ FIXTURE_UPLOAD_FAIL: failedAsset, FIXTURE_FAIL_AFTER_UPLOAD: accepted ? "1" : "" }).status, 23);
      const first = JSON.parse(await readFile(f.metadata, "utf8"));
      const count = publicationOrder.indexOf(failedAsset) + Number(accepted);
      assert.deepEqual(first.assets.map(asset => asset.name), publicationOrder.slice(0, count));
      assert.equal(first.assets.some(asset => asset.name === filename), count === 5);
      const before = (await f.calls()).length, recovered = path.join(f.root, "recovered");
      const restore = f.restore(recovered);
      assert.equal(restore.status, 0, restore.stderr);
      const resume = f.resume(recovered);
      assert.equal(resume.status, 0, resume.stderr);
      const after = (await f.calls()).slice(before);
      assert.deepEqual(uploadCalls(after).map(call => path.basename(call.args[3])), publicationOrder.slice(count));
      assert.ok(after.filter(call => call.command === "cosign").every(call => call.args[0] === "verify-blob"));
      for (const name of f.assets) assert.deepEqual(await readFile(path.join(f.published, name)), await readFile(path.join(f.local, name)));
      const snapshot = await readFile(f.metadata);
      assert.equal(f.resume(recovered).status, 0);
      assert.deepEqual(await readFile(f.metadata), snapshot);
      assert.equal(f.prepare(path.join(f.root, "announcement")).status, 0);
    });
  }
}

onReleasePlatform("resume accepts every matching subset without replacing or duplicating assets", async t => {
  for (let mask = 0; mask < 32; mask++) {
    await t.test(`existing asset mask ${mask}`, async t => {
      const f = await announcementFixture(t);
      const published = JSON.parse(await readFile(f.metadata, "utf8"));
      for (const [index, name] of publicationOrder.entries()) {
        if (!(mask & (1 << index))) continue;
        const data = await readFile(path.join(f.local, name));
        await writeFile(path.join(f.published, name), data);
        published.assets.push({ name, size: data.length, digest: "sha256:" + createHash("sha256").update(data).digest("hex"), state: "uploaded" });
      }
      await writeFile(f.metadata, JSON.stringify(published));
      const result = f.resume();
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(uploadCalls(await f.calls()).map(call => path.basename(call.args[3])), publicationOrder.filter((_, index) => !(mask & (1 << index))));
      assert.equal(JSON.parse(await readFile(f.metadata, "utf8")).assets.length, 5);
      for (const name of f.assets) assert.deepEqual(await readFile(path.join(f.published, name)), await readFile(path.join(f.local, name)));
    });
  }
});

for (const mismatch of ["digest", "size", "state", "duplicate"]) {
  onReleasePlatform(`resume rejects existing ${mismatch} mismatch before any missing asset upload`, async t => {
    const f = await announcementFixture(t);
    assert.equal(f.upload({ FIXTURE_UPLOAD_FAIL: publicationOrder[1] }).status, 23);
    const published = JSON.parse(await readFile(f.metadata, "utf8"));
    if (mismatch === "digest") published.assets[0].digest = "sha256:" + "b".repeat(64);
    if (mismatch === "size") published.assets[0].size++;
    if (mismatch === "state") published.assets[0].state = "starter";
    if (mismatch === "duplicate") published.assets.push(published.assets[0]);
    await writeFile(f.metadata, JSON.stringify(published));
    const before = uploadCalls(await f.calls()).length, result = f.resume();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Published bytes differ|Published asset metadata is missing or invalid/);
    assert.equal(uploadCalls(await f.calls()).length, before);
  });
}

for (const name of ["server.json", "sbom.cdx.json"]) {
  onReleasePlatform(`unsigned ${name} must match its bundle entry before publish, resume or announcement`, async t => {
    const f = await announcementFixture(t);
    const original = await readFile(path.join(f.local, name));
    await writeFile(path.join(f.local, name), "different metadata");
    for (const result of [f.upload(), f.resume()]) {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Release metadata does not match the bundle/);
    }
    assert.equal(uploadCalls(await f.calls()).length, 0);
    await writeFile(path.join(f.local, name), original);
    assert.equal(f.upload().status, 0);
    const changed = Buffer.from("different published metadata");
    await writeFile(path.join(f.published, name), changed);
    const release = JSON.parse(await readFile(f.metadata, "utf8"));
    Object.assign(release.assets.find(asset => asset.name === name), { size: changed.length, digest: "sha256:" + createHash("sha256").update(changed).digest("hex") });
    await writeFile(f.metadata, JSON.stringify(release));
    const result = f.prepare(path.join(f.root, "announcement"));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Release metadata does not match the bundle/);
  });
}

onReleasePlatform("large signed SBOMs are compared without the command's default buffer truncation", async t => {
  const f = await announcementFixture(t);
  const sbom = JSON.stringify({ components: [], fixture: "x".repeat(2 * 1024 * 1024) });
  await writeFile(path.join(f.local, "sbom.cdx.json"), sbom);
  await writeFile(path.join(f.local, filename), fixtureArchive({
    "manifest.json": JSON.stringify({ name: bundleName, version }),
    "server.json": await readFile(path.join(f.local, "server.json")),
    "sbom.cdx.json": sbom,
  }));
  const result = f.upload();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.resume().status, 0);
  assert.equal(f.prepare(path.join(f.root, "announcement")).status, 0);
});

for (const extra of [{ FIXTURE_BAD_SIGNATURE: "1" }, { FIXTURE_BAD_PROVENANCE: "1" }, { FIXTURE_EXPIRED: "1" }, { FIXTURE_MISSING: filename }]) {
  onReleasePlatform(`retained asset verification fails closed: ${JSON.stringify(extra)}`, async t => {
    const f = await announcementFixture(t), output = path.join(f.root, "recovered");
    assert.notEqual(f.restore(output, extra).status, 0);
    assert.equal(uploadCalls(await f.calls()).length, 0);
    assert.equal((await readdir(f.published)).length, 0);
  });
}

for (const patch of [
  { id: 456 }, { repository: { full_name: "other/repository" } }, { head_sha: "b".repeat(40) },
  { head_branch: "main" }, { path: ".github/workflows/other.yml" }, { event: "push" }, { status: "in_progress" },
]) {
  onReleasePlatform(`a recovery run must match its original release context: ${JSON.stringify(patch)}`, async t => {
    const f = await announcementFixture(t);
    const original = JSON.parse(await readFile(f.runMetadata, "utf8"));
    await writeFile(f.runMetadata, JSON.stringify({ ...original, ...patch }));
    const result = f.restore(path.join(f.root, "recovered"));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /completed mpak release dispatch/);
    assert.equal((await f.calls()).filter(call => call.args?.includes("download")).length, 0);
    assert.equal(uploadCalls(await f.calls()).length, 0);
  });
}

for (const runId of ["", "0", "-1", "00123", "1.5", "9007199254740992", "123\n", "123;echo", "123/../456"]) {
  test(`invalid recovery run ID fails before commands: ${JSON.stringify(runId)}`, async t => {
    const f = await announcementFixture(t), result = f.restore(path.join(f.root, "recovered"), {}, runId);
    assert.notEqual(result.status, 0);
    assert.deepEqual(await f.calls(), []);
  });
}

test("release dispatch retains default publish and supports fresh announcement without a publish job", async () => {
  const workflow = (await readFile(path.join(repo, ".github/workflows/mpak-release.yml"), "utf8")).replace(/\r\n/g, "\n");
  assert.match(workflow, /default: publish\n        options:\n          - publish\n          - resume\n          - announce/);
  assert.match(workflow, /publish:\n    if: inputs\.operation != 'announce'/);
  assert.match(workflow, /always\(\) && !cancelled\(\) && \(inputs\.operation == 'announce' \|\| needs\.publish\.result == 'success'\)/);
  assert.ok(workflow.indexOf('--preflight "$RELEASE_TAG"') < workflow.indexOf("      - name: Install root dependencies"));
  assert.ok(workflow.indexOf("      - name: Retain the exact signed asset set") < workflow.indexOf("      - name: Upload new mpak assets"));
  assert.ok(workflow.indexOf("      - name: Finalize mpak bundle metadata") < workflow.indexOf("      - name: Sign mpak bundle with Sigstore keyless"));
  assert.match(workflow, /retention-days: 90/);
  const publishOnlySteps = ["Install root dependencies", "Run root test suite", "Build universal mpak bundle", "Sign mpak bundle with Sigstore keyless", "Generate build provenance attestation", "Retain the exact signed asset set before publication"];
  for (const step of publishOnlySteps) assert.ok(workflow.includes(`      - name: ${step}\n        if: inputs.operation == 'publish'`));
});

onReleasePlatform("the actual publication context step accepts only the selected tag, commit and operation", async t => {
  const f = await announcementFixture(t);
  await writeFile(path.join(f.root, "bin/git"), `#!${process.execPath}\nprocess.stdout.write('${sourceDigest}\\n');\n`, { mode: 0o755 });
  const workflow = (await readFile(path.join(repo, ".github/workflows/mpak-release.yml"), "utf8")).replace(/\r\n/g, "\n");
  const step = workflow.split("      - name: Bind source ref to workflow provenance\n")[1]?.split("\n      - ")[0];
  const body = step?.split("        run: |\n")[1];
  assert.ok(body, "The actual context binding shell must be present");
  const shell = body.split("\n").map(line => line.startsWith("          ") ? line.slice(10) : line).join("\n");
  const execute = extra => spawnSync("bash", ["-c", shell], { env: { ...f.env, RELEASE_TAG: tag, OPERATION: "publish", RECOVERY_RUN_ID: "", ...extra }, encoding: "utf8" });
  for (const extra of [{}, { OPERATION: "resume", RECOVERY_RUN_ID: "123" }]) {
    const result = execute(extra);
    assert.equal(result.status, 0, result.stderr);
  }
  for (const extra of [{ OPERATION: "announce" }, { OPERATION: "unknown" }, { OPERATION: "resume" }, { OPERATION: "resume", RECOVERY_RUN_ID: "123;echo" }, { SOURCE_REF: "main" }, { GITHUB_REF: "refs/heads/main" }, { GITHUB_SHA: "b".repeat(40) }]) {
    assert.notEqual(execute(extra).status, 0, JSON.stringify(extra));
  }
  assert.deepEqual(await f.calls(), []);
});

test("staging retains the reference, Kiro guide and both configuration files", async t => {
  const f = await fixture(t), npmCli = path.join(f.root, "npm fixture.mjs");
  await writeFile(npmCli, "import {mkdirSync,writeFileSync} from 'node:fs'; if(process.argv[2]==='run'){mkdirSync('dist',{recursive:true});writeFileSync('dist/cli.js','// fresh fixture runtime');}\n");
  const result = f.run("prepare-mpak-package.mjs", [], { npm_execpath: npmCli, MPAK_STAGING_DIR: f.staging });
  assert.equal(result.status, 0, result.stderr);
  const pkg = JSON.parse(await readFile(path.join(repo, "package.json"), "utf8"));
  for (const relative of ["REFERENCE.md", "packaging/kiro/README.md", "packaging/kiro/mcp.json", "packaging/kiro/plugin.json"]) {
    assert.deepEqual(await readFile(path.join(f.staging, relative)), await readFile(path.join(f.repository, relative)));
    assert.ok(pkg.files.includes(relative));
  }
  assert.match(await readFile(path.join(repo, "Dockerfile"), "utf8"), /COPY packaging\/kiro\/ \.\/packaging\/kiro\//);
  const runtime = (await readFile(path.join(repo, "Dockerfile"), "utf8")).split(" AS runtime")[1];
  assert.match(runtime, /^COPY [^\n]*\bREFERENCE\.md\b[^\n]* \.\/$/m);
});

async function bundleFixture(t) {
  const f = await fixture(t), entries = {};
  for (const name of ["LICENSE", "README.md", "REFERENCE.md", "CHANGELOG.md", "SECURITY.md", "CONTRIBUTING.md", "RELEASING.md", "packaging/mpak/README.md", "packaging/kiro/README.md", "packaging/kiro/mcp.json", "packaging/kiro/plugin.json", "icon.png", "manifest.json", "package-lock.json", "package.json", "sbom.cdx.json", "server.json"]) {
    entries[name] = name === "manifest.json" ? JSON.stringify({ name: bundleName, version }) : "fixture";
    await mkdir(path.dirname(path.join(f.staging, name)), { recursive: true });
    await writeFile(path.join(f.staging, name), entries[name]);
  }
  const bundle = path.join(f.root, "bundle with spaces %20.mcpb");
  await writeFile(bundle, fixtureArchive(entries));
  return { ...f, entries, bundle, finalize: () => f.run("finalize-mpak-bundle.mjs", [bundle, f.staging]) };
}

const invalidManifests = [
  ["wrong package name", JSON.stringify({ name: "@other/server", version })],
  ["unscoped package name", JSON.stringify({ name: "ipgeolocation-io-mcp", version })],
  ["wrong version", JSON.stringify({ name: bundleName, version: "9.9.9" })],
  ["non-string version", JSON.stringify({ name: bundleName, version: 2 })],
  ["malformed JSON", "not JSON"],
  ["truncated JSON", '{"name":'],
  ["null", "null"],
  ["array", JSON.stringify([{ name: bundleName, version }])],
  ["invalid UTF-8", Buffer.concat([Buffer.from(JSON.stringify({ name: bundleName, version }).slice(0, -1) + ',"note":"'), Buffer.from([0xff]), Buffer.from('"}')])],
  ["UTF-8 BOM", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify({ name: bundleName, version }))])],
  ["oversized", JSON.stringify({ name: bundleName, version, note: "x".repeat(1024 * 1024) })],
  ["missing", undefined],
  ["duplicate", JSON.stringify({ name: bundleName, version })],
];

function manifestEntries(entries, mode, contents) {
  const result = Object.entries(entries).filter(([name]) => name !== "manifest.json");
  if (mode !== "missing") result.push(["manifest.json", contents]);
  if (mode === "duplicate") result.push(["manifest.json", ""]);
  return result;
}

for (const [mode, contents] of invalidManifests) {
  onReleasePlatform(`all release paths reject a ${mode} manifest`, async t => {
    await t.test("finalization before signing", async t => {
      const f = await bundleFixture(t);
      await writeFile(f.bundle, fixtureArchive(manifestEntries(f.entries, mode, contents)));
      const before = await readFile(path.join(f.staging, "manifest.json"));
      const result = f.finalize();
      assert.notEqual(result.status, 0, result.stdout);
      assert.match(result.stderr, /manifest/i);
      assert.deepEqual(await readFile(path.join(f.staging, "manifest.json")), before);
    });
    await t.test("upload, resume, restore and announcement", async t => {
      const f = await announcementFixture(t);
      const entries = {};
      for (const name of ["server.json", "sbom.cdx.json"]) entries[name] = await readFile(path.join(f.local, name));
      await writeFile(path.join(f.local, filename), fixtureArchive(manifestEntries(entries, mode, contents)));
      const upload = f.upload();
      assert.notEqual(upload.status, 0, upload.stdout);
      assert.match(upload.stderr, /manifest/i);
      assert.deepEqual(await f.calls(), [], "Normal upload must reject the manifest before calling GitHub");
      for (const result of [f.resume(), f.restore(path.join(f.root, "restored"))]) {
        assert.notEqual(result.status, 0, result.stdout);
        assert.match(result.stderr, /manifest/i);
      }
      await seedPublishedAssets(f);
      const output = path.join(f.root, "download"), announcement = f.prepare(output);
      assert.notEqual(announcement.status, 0, announcement.stdout);
      assert.match(announcement.stderr, /manifest/i);
      assert.equal(uploadCalls(await f.calls()).length, 0);
      await assert.rejects(readFile(path.join(output, "announcement.json")), { code: "ENOENT" });
    });
  });
}

for (const [mode, contents] of invalidManifests.filter(([mode]) => !["missing", "duplicate"].includes(mode))) {
  onReleasePlatform(`finalization rejects ${mode} staging even when the archive is valid`, async t => {
    const f = await bundleFixture(t);
    await writeFile(path.join(f.staging, "manifest.json"), contents);
    const result = f.finalize();
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /manifest/i);
  });
}

onReleasePlatform("matching tampered manifests cannot replace the canonical package identity", async t => {
  for (const manifest of [{ name: "@other/server", version }, { name: bundleName, version: "9.9.9" }]) {
    const f = await bundleFixture(t);
    f.entries["manifest.json"] = JSON.stringify(manifest);
    await writeFile(path.join(f.staging, "manifest.json"), f.entries["manifest.json"]);
    await writeFile(f.bundle, fixtureArchive(f.entries));
    const result = f.finalize();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /bundle manifest does not match/);
  }
});

onReleasePlatform("finalization verifies the explicitly selected source version", async t => {
  const f = await bundleFixture(t), source = path.join(f.root, "selected source %20");
  await mkdir(source);
  await writeFile(path.join(source, "package.json"), JSON.stringify({ version: "3.0.0" }));
  f.entries["manifest.json"] = JSON.stringify({ name: bundleName, version: "3.0.0" });
  await writeFile(path.join(f.staging, "manifest.json"), f.entries["manifest.json"]);
  await writeFile(f.bundle, fixtureArchive(f.entries));
  assert.notEqual(f.finalize().status, 0, "The tooling package version must not accept a different manifest");
  const result = f.run("finalize-mpak-bundle.mjs", [f.bundle, f.staging], { MPAK_SOURCE_DIR: source });
  assert.equal(result.status, 0, result.stderr);
});

for (const sourceVersion of ["2.0.1", "2.0.3"]) {
  onReleasePlatform(`scan prepares and finalizes source ${sourceVersion} with tooling ${version}`, async t => {
    const workflow = (await readFile(path.join(repo, ".github/workflows/mpak-scan.yml"), "utf8")).replace(/\r\n/g, "\n");
    const steps = workflow.split(/^      - /m);
    const stepEnvironment = command => {
      const step = steps.find(value => value.includes(`node scripts/${command}`));
      assert.ok(step, `Missing workflow step for ${command}`);
      assert.match(step, /^        working-directory: tooling$/m);
      const source = step.match(/^          MPAK_SOURCE_DIR: (.+)$/m)?.[1];
      return source ? { MPAK_SOURCE_DIR: source } : {};
    };
    const f = await fixture(t), source = path.join(f.root, "source");
    await cp(f.repository, source, { recursive: true });
    const packagePath = path.join(source, "package.json"), pkg = JSON.parse(await readFile(packagePath, "utf8"));
    await writeFile(packagePath, JSON.stringify({ ...pkg, version: sourceVersion }));
    await writeFile(path.join(source, "icon.png"), "fixture icon");
    const npmCli = path.join(f.root, "npm fixture.mjs");
    await writeFile(npmCli, `import fs from 'node:fs';
if(process.argv[2]==='run'){fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/cli.js','// selected source '+JSON.parse(fs.readFileSync('package.json')).version);}
`);
    const prepared = f.run("prepare-mpak-package.mjs", [], {
      ...stepEnvironment("prepare-mpak-package.mjs"), npm_execpath: npmCli, MPAK_STAGING_DIR: f.staging,
    });
    assert.equal(prepared.status, 0, prepared.stderr);
    assert.equal(JSON.parse(await readFile(path.join(f.staging, "manifest.json"))).version, sourceVersion);
    assert.equal(await readFile(path.join(f.staging, "dist/cli.js"), "utf8"), `// selected source ${sourceVersion}`);
    await writeFile(path.join(f.staging, "sbom.cdx.json"), "fixture SBOM");
    const entries = {};
    for (const entry of await readdir(f.staging, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) {
        const file = path.join(entry.parentPath ?? entry.path, entry.name);
        entries[path.relative(f.staging, file).split(path.sep).join("/")] = await readFile(file);
      }
    }
    const bundle = path.join(f.root, "scanned source.mcpb");
    await writeFile(bundle, fixtureArchive(entries));
    const result = f.run("finalize-mpak-bundle.mjs", [bundle, f.staging], stepEnvironment("finalize-mpak-bundle.mjs"));
    assert.equal(result.status, 0, result.stderr);
  });
}

onReleasePlatform("a valid manifest at the size limit passes finalization and every publication path", async t => {
  const f = await bundleFixture(t);
  const manifest = JSON.stringify({ name: bundleName, version }).padEnd(1024 * 1024, " ");
  f.entries["manifest.json"] = manifest;
  await writeFile(path.join(f.staging, "manifest.json"), manifest);
  await writeFile(f.bundle, fixtureArchive(f.entries));
  const finalization = f.finalize();
  assert.equal(finalization.status, 0, finalization.stderr);
  const release = await announcementFixture(t), entries = { "manifest.json": manifest };
  for (const name of ["server.json", "sbom.cdx.json"]) entries[name] = await readFile(path.join(release.local, name));
  await writeFile(path.join(release.local, filename), fixtureArchive(entries));
  for (const result of [release.upload(), release.resume(), release.restore(path.join(release.root, "restored")), release.prepare(path.join(release.root, "download"))]) {
    assert.equal(result.status, 0, result.stderr);
  }
  assert.equal(uploadCalls(await release.calls()).length, 5, "Resume must not replace published assets");
});

onReleasePlatform("an oversized manifest stops the extractor even if it handles SIGTERM", async t => {
  const f = await announcementFixture(t);
  const marker = path.join(f.root, "extractor-continued");
  await writeFile(path.join(f.root, "bin", "unzip"), `#!${process.execPath}
if (process.argv[2] === "-Z1") {
  console.log("manifest.json");
} else {
  process.on("SIGTERM", () => {
    require("node:fs").writeFileSync(process.env.FIXTURE_CONTINUED, "continued");
    process.exit(0);
  });
  process.stdout.on("error", () => {});
  process.stdout.write(Buffer.alloc(2 * 1024 * 1024));
  setTimeout(() => process.exit(1), 5000);
}
`, { mode: 0o755 });
  const result = f.upload({ FIXTURE_CONTINUED: marker });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /manifest/i);
  await assert.rejects(lstat(marker), { code: "ENOENT" });
  assert.deepEqual(await f.calls(), []);
});

onReleasePlatform("bundle finalization rejects a missing reference or Kiro file in staging or inside the archive", async t => {
  const f = await bundleFixture(t), { entries, bundle } = f;
  assert.equal(f.finalize().status, 0);
  for (const relative of ["REFERENCE.md", "packaging/kiro/README.md", "packaging/kiro/mcp.json", "packaging/kiro/plugin.json"]) {
    await rm(path.join(f.staging, relative));
    const missingStaging = f.run("finalize-mpak-bundle.mjs", [bundle, f.staging]);
    assert.notEqual(missingStaging.status, 0);
    assert.ok(missingStaging.stderr.includes(`Required mpak file is missing from staging: ${relative}`), missingStaging.stderr);
    await writeFile(path.join(f.staging, relative), entries[relative]);
    const omitted = { ...entries }; delete omitted[relative];
    await writeFile(bundle, fixtureArchive(omitted));
    const missingArchive = f.run("finalize-mpak-bundle.mjs", [bundle, f.staging]);
    assert.notEqual(missingArchive.status, 0);
    assert.ok(missingArchive.stderr.includes(`Required file is missing from the mpak bundle: ${relative}`), missingArchive.stderr);
    await writeFile(bundle, fixtureArchive(entries));
  }
});

for (const name of ["server.json", "sbom.cdx.json"]) {
  onReleasePlatform(`bundle finalization compares exact ${name} bytes before signing`, async t => {
    const f = await bundleFixture(t);
    for (const changed of [Buffer.from("fixture\n"), Buffer.from([102, 105, 120, 116, 117, 114, 255])]) {
      await writeFile(path.join(f.staging, name), changed);
      const result = f.finalize();
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Release metadata does not match the bundle/);
    }
  });

  for (const mode of ["missing", "duplicate", "oversized"]) {
    onReleasePlatform(`bundle finalization rejects ${mode} ${name} without changing staging`, async t => {
      const f = await bundleFixture(t), before = await readFile(path.join(f.staging, name));
      let entries = Object.entries(f.entries);
      if (mode === "missing") entries = entries.filter(([entry]) => entry !== name);
      if (mode === "duplicate") entries.push([name, ""]);
      if (mode === "oversized") entries = entries.map(([entry, value]) => [entry, entry === name ? "fixture" + "x".repeat(2 * 1024 * 1024) : value]);
      await writeFile(f.bundle, fixtureArchive(entries));
      const result = f.finalize();
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, mode === "missing" ? /Required file is missing/ : mode === "duplicate" ? /appears more than once/ : /Unable to read bundled metadata/);
      assert.deepEqual(await readFile(path.join(f.staging, name)), before);
    });
  }
}

onReleasePlatform("finalization accepts a matching SBOM beyond the default subprocess buffer", async t => {
  const f = await bundleFixture(t);
  f.entries["sbom.cdx.json"] = JSON.stringify({ components: [], fixture: "x".repeat(2 * 1024 * 1024) });
  await writeFile(path.join(f.staging, "sbom.cdx.json"), f.entries["sbom.cdx.json"]);
  await writeFile(f.bundle, fixtureArchive(f.entries));
  const result = f.finalize();
  assert.equal(result.status, 0, result.stderr);
});

onReleasePlatform("finalization refuses truncated archives", async t => {
  const f = await bundleFixture(t);
  await writeFile(f.bundle, (await readFile(f.bundle)).subarray(0, 100));
  const result = f.finalize();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unable to list mpak bundle contents/);
});

onReleasePlatform("normal upload verifies metadata supplied from different directories", async t => {
  const f = await announcementFixture(t), files = [];
  for (const [index, name] of f.assets.entries()) {
    const directory = path.join(f.root, `asset ${index}`);
    await mkdir(directory);
    const file = path.join(directory, name);
    await cp(path.join(f.local, name), file);
    files.unshift(file);
  }
  const result = f.run("upload-mpak-release-assets.mjs", [tag, ...files], f.env);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(uploadCalls(await f.calls()).map(call => path.basename(call.args[3])), publicationOrder);
});

onReleasePlatform("normal upload rejects duplicate metadata entries before any upload", async t => {
  const f = await announcementFixture(t);
  const entries = [["manifest.json", JSON.stringify({ name: bundleName, version })]];
  for (const name of ["server.json", "sbom.cdx.json"]) entries.push([name, await readFile(path.join(f.local, name))]);
  entries.push(["server.json", ""]);
  await writeFile(path.join(f.local, filename), fixtureArchive(entries));
  const result = f.upload();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must contain exactly one server.json/);
  assert.equal(uploadCalls(await f.calls()).length, 0);
});

onReleasePlatform("normal upload rejects successful extraction with truncated metadata", async t => {
  const f = await announcementFixture(t), bin = path.join(f.root, "truncated-tool");
  await mkdir(bin);
  await writeFile(path.join(bin, "unzip"), `#!${process.execPath}\nconst manifest=process.argv.at(-1)==='manifest.json';process.stdout.write(process.argv[2] === '-Z1' ? 'manifest.json\\nserver.json\\nsbom.cdx.json\\n' : (manifest?${JSON.stringify(JSON.stringify({ name: bundleName, version }))}:'{'));\n`, { mode: 0o755 });
  const result = f.upload({ PATH: `${bin}${path.delimiter}${f.env.PATH}` });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Release metadata does not match the bundle/);
  assert.equal(uploadCalls(await f.calls()).length, 0);
});

for (const sourceKind of ["current", "sibling", "linked dist"]) {
  test(`manual packaging builds fresh ${sourceKind} source instead of copying stale dist`, async t => {
    const f = await fixture(t);
    const source = sourceKind === "sibling" ? path.join(f.root, "selected source %20") : f.repository;
    if (source !== f.repository) await cp(f.repository, source, { recursive: true });
    const pkg = JSON.parse(await readFile(path.join(source, "package.json"), "utf8"));
    pkg.scripts = { build: "node build.mjs" };
    await writeFile(path.join(source, "package.json"), JSON.stringify(pkg));
    await writeFile(path.join(source, "build.mjs"), "import {mkdirSync,writeFileSync} from 'node:fs';mkdirSync('dist',{recursive:true});writeFileSync('dist/cli.js','// current selected source\\n');");
    let outside;
    if (sourceKind === "linked dist") {
      outside = path.join(f.root, "outside dist");
      await mkdir(outside);
      await writeFile(path.join(outside, "keep.txt"), "outside files must survive");
      await rm(path.join(source, "dist"), { recursive: true });
      await symlink(outside, path.join(source, "dist"), process.platform === "win32" ? "junction" : "dir");
    } else await writeFile(path.join(source, "dist/stale.js"), "removed source must not ship");
    const npmCli = process.env.npm_execpath || path.resolve(path.dirname(process.execPath), process.platform === "win32" ? "node_modules/npm/bin/npm-cli.js" : "../lib/node_modules/npm/bin/npm-cli.js");
    const npmConfig = path.join(f.root, "empty.npmrc");
    await writeFile(npmConfig, "");
    const result = f.run("prepare-mpak-package.mjs", [], { npm_execpath: npmCli, MPAK_SOURCE_DIR: source, MPAK_STAGING_DIR: f.staging, npm_config_cache: path.join(f.root, "npm-cache"), npm_config_userconfig: npmConfig, npm_config_offline: "true", npm_config_audit: "false", npm_config_fund: "false" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(path.join(f.staging, "dist/cli.js"), "utf8"), "// current selected source\n");
    await assert.rejects(readFile(path.join(f.staging, "dist/stale.js")), { code: "ENOENT" });
    if (source !== f.repository) assert.equal(await readFile(path.join(f.repository, "dist/cli.js"), "utf8"), "// Fixture runtime\n");
    if (outside) assert.equal(await readFile(path.join(outside, "keep.txt"), "utf8"), "outside files must survive");
  });
}

test("a build that creates no runtime cannot stage the old dist files", async t => {
  const f = await fixture(t), npmCli = path.join(f.root, "empty build.mjs");
  await writeFile(npmCli, "// Synthetic successful command with no build output.\n");
  await writeFile(path.join(f.staging, "keep.txt"), "previous package");
  const result = f.run("prepare-mpak-package.mjs", [], { npm_execpath: npmCli, MPAK_STAGING_DIR: f.staging });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source build did not create dist/);
  assert.equal(await readFile(path.join(f.staging, "keep.txt"), "utf8"), "previous package");
  await assert.rejects(readFile(path.join(f.repository, "dist/cli.js")), { code: "ENOENT" });
});


const ambiguousBundlePaths = [
  ["manifest dot alias", ["./manifest.json"]],
  ["server dot alias", ["./server.json"]],
  ["SBOM dot alias", ["./sbom.cdx.json"]],
  ["manifest directory alias", ["manifest.json/"]],
  ["manifest case alias", ["MANIFEST.JSON"]],
  ["server case alias", ["SERVER.JSON"]],
  ["SBOM case alias", ["SBOM.CDX.JSON"]],
  ["absolute path", ["/manifest.json"]],
  ["drive path", ["C:/manifest.json"]],
  ["drive-relative path", ["C:manifest.json"]],
  ["backslash path", ["nested\\manifest.json"]],
  ["parent traversal", ["../manifest.json"]],
  ["nested parent traversal", ["nested/../../manifest.json"]],
  ["normalizing parent segment", ["nested/../manifest.json"]],
  ["normalizing dot segment", ["nested/./manifest.json"]],
  ["empty path segment", ["nested//manifest.json"]],
  ["file before child", ["node_modules/pkg", "node_modules/pkg/index.js"]],
  ["child before file", ["node_modules/pkg/index.js", "node_modules/pkg"]],
  ["case-only directory collision", ["node_modules/Package/one.js", "node_modules/package/two.js"]],
  ["Unicode-normalized path collision", ["node_modules/é/index.js", "node_modules/e\u0301/other.js"]],
  ["Unicode case-fold path collision", ["node_modules/ß/index.js", "node_modules/SS/other.js"]],
  ["uppercase sharp S directory collision", ["node_modules/ẞ/index.js", "node_modules/ß/other.js"]],
  ["expanded uppercase sharp S filename collision", ["node_modules/pkg/ẞ.js", "node_modules/pkg/ss.js"]],
  ["Greek case-fold path collision", ["node_modules/ΐ/index.js", "node_modules/Ϊ\u0301/other.js"]],
  ["newline in filename", ["node_modules/pkg/line\nbreak.js"]],
  ["tab in filename", ["node_modules/pkg/tab\tname.js"]],
  ["escape in filename", ["node_modules/pkg/escape\u001bname.js"]],
  ["carriage return in filename", ["node_modules/pkg/return\rname.js"]],
  ["literal caret ambiguity", ["node_modules/pkg/line^Jbreak.js"]],
  ["double trailing slash", ["node_modules//"]],
  ["Windows device basename", ["node_modules/pkg/NUL.txt"]],
  ["Windows numbered device directory", ["node_modules/cOm1/file.js"]],
  ["trailing-dot alias", ["manifest.json."]],
  ["trailing-space alias", ["manifest.json "]],
];

for (const [label, aliases] of ambiguousBundlePaths) {
  onReleasePlatform(`all release paths reject ${label}`, async t => {
    const finalized = await bundleFixture(t);
    const extras = aliases.map(name => [name, "untrusted alias"]);
    await writeFile(finalized.bundle, fixtureArchive([...Object.entries(finalized.entries), ...extras]));
    const result = finalized.finalize();
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /bundle.*path|bundle.*exactly one/i);
    const release = await announcementFixture(t);
    const entries = [["manifest.json", JSON.stringify({ name: bundleName, version })]];
    for (const name of ["server.json", "sbom.cdx.json"]) entries.push([name, await readFile(path.join(release.local, name))]);
    await writeFile(path.join(release.local, filename), fixtureArchive([...entries, ...extras]));
    const upload = release.upload();
    assert.notEqual(upload.status, 0, upload.stdout);
    assert.match(upload.stderr, /bundle.*path|bundle.*exactly one/i);
    assert.deepEqual(await release.calls(), [], "Invalid archive paths must be rejected before normal publication contacts GitHub");
    for (const outcome of [release.resume(), release.restore(path.join(release.root, "restored"))]) {
      assert.notEqual(outcome.status, 0, outcome.stdout);
      assert.match(outcome.stderr, /bundle.*path|bundle.*exactly one/i);
    }
    await seedPublishedAssets(release);
    const output = path.join(release.root, "announcement");
    const announcement = release.prepare(output);
    assert.notEqual(announcement.status, 0, announcement.stdout);
    assert.match(announcement.stderr, /bundle.*path|bundle.*exactly one/i);
    assert.equal(uploadCalls(await release.calls()).length, 0);
    await assert.rejects(readFile(path.join(output, "announcement.json")), { code: "ENOENT" });
  });
}

onReleasePlatform("valid nested bundle files and explicit directories pass every release path", async t => {
  const f = await bundleFixture(t);
  const extra = { "node_modules/": "", "node_modules/@scope/": "", "node_modules/@scope/pkg/": "", "node_modules/@scope/pkg/file..name.js": "valid content", "node_modules/@scope/pkg/.config": "valid dotfile", "node_modules/@scope/other-package.js": "valid sibling", "node_modules/@scope/pkg/café.js": "valid UTF-8 filename" };
  await writeFile(f.bundle, fixtureArchive({ ...f.entries, ...extra }));
  assert.equal(f.finalize().status, 0);
  const release = await announcementFixture(t), entries = { "manifest.json": JSON.stringify({ name: bundleName, version }), ...extra };
  for (const name of ["server.json", "sbom.cdx.json"]) entries[name] = await readFile(path.join(release.local, name));
  await writeFile(path.join(release.local, filename), fixtureArchive(entries));
  for (const result of [release.upload(), release.resume(), release.restore(path.join(release.root, "restored")), release.prepare(path.join(release.root, "download"))]) {
    assert.equal(result.status, 0, result.stderr);
  }
});

onReleasePlatform("scan accepts older source without the reference or Kiro packaging", async t => {
  const f = await fixture(t), source = path.join(f.root, "old source");
  await cp(f.repository, source, { recursive: true });
  const pkg = JSON.parse(await readFile(path.join(source, "package.json"), "utf8"));
  pkg.version = "2.0.1";
  pkg.files = ["dist", "manifest.json", "server.json", "packaging/mpak/README.md"];
  await writeFile(path.join(source, "package.json"), JSON.stringify(pkg));
  await rm(path.join(source, "packaging/kiro"), { recursive: true });
  await rm(path.join(source, "REFERENCE.md"));
  await writeFile(path.join(source, "icon.png"), "fixture icon");
  const npmCli = path.join(f.root, "npm fixture.mjs");
  await writeFile(npmCli, "import fs from 'node:fs';if(process.argv[2]==='run'){fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/cli.js','// selected old source');}");
  const env = { MPAK_SOURCE_DIR: source, MPAK_STAGING_DIR: f.staging, npm_execpath: npmCli };
  const prepared = f.run("prepare-mpak-package.mjs", [], env);
  assert.equal(prepared.status, 0, prepared.stderr);
  await assert.rejects(lstat(path.join(f.staging, "packaging/kiro")), { code: "ENOENT" });
  await assert.rejects(lstat(path.join(f.staging, "REFERENCE.md")), { code: "ENOENT" });
  await writeFile(path.join(f.staging, "sbom.cdx.json"), "fixture SBOM");
  const entries = {};
  for (const entry of await readdir(f.staging, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath ?? entry.path, entry.name);
    entries[path.relative(f.staging, file).split(path.sep).join("/")] = await readFile(file);
  }
  const bundle = path.join(f.root, "old-source.mcpb");
  await writeFile(bundle, fixtureArchive(entries));
  const finalized = f.run("finalize-mpak-bundle.mjs", [bundle, f.staging], env);
  assert.equal(finalized.status, 0, finalized.stderr);
});

test("a declared reference must exist before building or replacing staged files", async t => {
  const f = await fixture(t), pkg = JSON.parse(await readFile(path.join(f.repository, "package.json"), "utf8"));
  pkg.files = ["REFERENCE.md"];
  await writeFile(path.join(f.repository, "package.json"), JSON.stringify(pkg));
  await rm(path.join(f.repository, "REFERENCE.md"));
  await writeFile(path.join(f.staging, "keep.txt"), "previous staged content");
  const result = f.run("prepare-mpak-package.mjs", [], { MPAK_STAGING_DIR: f.staging });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Required mpak source file is missing: REFERENCE\.md/);
  assert.equal(await readFile(path.join(f.staging, "keep.txt"), "utf8"), "previous staged content");
  assert.equal(await readFile(path.join(f.repository, "dist/cli.js"), "utf8"), "// Fixture runtime\n");
});

onReleasePlatform("finalization requires a declared reference even if the source file is absent", async t => {
  const f = await bundleFixture(t), pkg = JSON.parse(await readFile(path.join(f.repository, "package.json"), "utf8"));
  pkg.files = ["REFERENCE.md"];
  await writeFile(path.join(f.repository, "package.json"), JSON.stringify(pkg));
  await rm(path.join(f.repository, "REFERENCE.md"));
  await rm(path.join(f.staging, "REFERENCE.md"));
  const result = f.finalize();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Required mpak file is missing from staging: REFERENCE\.md/);
});

for (const declaration of ["packaging/kiro", "packaging/kiro/README.md", "packaging/kiro/**"]) {
  test(`declared Kiro packaging remains required when its directory is missing: ${declaration}`, async t => {
    const f = await fixture(t), pkg = JSON.parse(await readFile(path.join(f.repository, "package.json"), "utf8"));
    pkg.files = [declaration];
    await writeFile(path.join(f.repository, "package.json"), JSON.stringify(pkg));
    await rm(path.join(f.repository, "packaging/kiro"), { recursive: true });
    await writeFile(path.join(f.staging, "keep.txt"), "previous staged content");
    const result = f.run("prepare-mpak-package.mjs", [], { MPAK_STAGING_DIR: f.staging });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Required mpak source file is missing: packaging\/kiro\/README.md/);
    assert.equal(await readFile(path.join(f.staging, "keep.txt"), "utf8"), "previous staged content");
    assert.equal(await readFile(path.join(f.repository, "dist/cli.js"), "utf8"), "// Fixture runtime\n");
  });
}

test("a partial undeclared Kiro directory is rejected before building", async t => {
  const f = await fixture(t);
  await rm(path.join(f.repository, "packaging/kiro/plugin.json"));
  const result = f.run("prepare-mpak-package.mjs", [], { MPAK_STAGING_DIR: f.staging });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Required mpak source file is missing: packaging\/kiro\/plugin.json/);
  assert.equal(await readFile(path.join(f.repository, "dist/cli.js"), "utf8"), "// Fixture runtime\n");
});


onReleasePlatform("a truncated archive listing cannot hide unsafe entries", async t => {
  const f = await bundleFixture(t), entries = Object.entries(f.entries);
  for (let index = 0; index < 30000; index++) entries.push([`node_modules/test/deep-package-file-${index}.js`, ""]);
  entries.push(["./manifest.json", "hidden alias"]);
  await writeFile(f.bundle, fixtureArchive(entries));
  const result = f.finalize();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unable to list mpak bundle contents/);
});

onReleasePlatform("finalization requires declared Kiro files even if the source directory is absent", async t => {
  const f = await bundleFixture(t), pkg = JSON.parse(await readFile(path.join(f.repository, "package.json"), "utf8"));
  pkg.files = ["packaging/kiro/README.md", "packaging/kiro/mcp.json", "packaging/kiro/plugin.json"];
  await writeFile(path.join(f.repository, "package.json"), JSON.stringify(pkg));
  await rm(path.join(f.repository, "packaging/kiro"), { recursive: true });
  await rm(path.join(f.staging, "packaging/kiro"), { recursive: true });
  const result = f.finalize();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Required mpak file is missing from staging: packaging\/kiro\/README.md/);
});


for (const [label, locale] of [["unset", { LANG: undefined, LC_ALL: undefined, LC_CTYPE: undefined }], ["C", { LANG: "C", LC_ALL: "C", LC_CTYPE: "C" }]]) {
  onReleasePlatform(`bundle verification preserves valid UTF-8 paths with ${label} user locale`, async t => {
    const f = await bundleFixture(t);
    await writeFile(f.bundle, fixtureArchive({ ...f.entries, "node_modules/pkg/café.js": "valid UTF-8 filename" }));
    const result = f.run("finalize-mpak-bundle.mjs", [f.bundle, f.staging], locale);
    assert.equal(result.status, 0, result.stderr);
    await writeFile(path.join(f.staging, "server.json"), "changed sidecar");
    const mismatch = f.run("finalize-mpak-bundle.mjs", [f.bundle, f.staging], locale);
    assert.notEqual(mismatch.status, 0);
    assert.match(mismatch.stderr, /Release metadata does not match the bundle/);
  });
}
