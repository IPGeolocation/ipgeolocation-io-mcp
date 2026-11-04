import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { fixtureArchive } from "./fixtures/archive.fixture.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const script = path.join(repo, "scripts/upload-mpak-release-assets.mjs");
const releaseCliTest = (name, handler) => test(name, {
  skip: process.platform === "win32" ? "The release workflow runs on Linux; this CLI fixture uses a POSIX executable." : false,
}, handler);
const bundleFilename = "ipgeolocation-ipgeolocation-io-mcp-2.0.2.mcpb";
const assetNames = [bundleFilename, "server.json", "sbom.cdx.json", `${bundleFilename}.sigstore.json`, `${bundleFilename}.provenance.sigstore.json`];
const releaseInspection = [
  ["api", "repos/IPGeolocation/ipgeolocation-io-mcp/commits/refs%2Ftags%2Fv2.0.2"],
  ["api", "repos/IPGeolocation/ipgeolocation-io-mcp/releases/tags/v2.0.2"],
];

async function setup(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "release-assets-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  await mkdir(bin);
  const log = path.join(root, "calls.jsonl");
  await writeFile(path.join(bin, "gh"), `#!${process.execPath}\n` + `
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'api' && args[1].includes('/commits/')) {
  process.stdout.write(JSON.stringify({ sha: process.env.FAKE_GH_TAG_SHA }));
} else if (args[0] === 'api' && args[1].includes('/releases/tags/')) {
  if (process.env.FAKE_GH_VIEW_FAIL) { process.stderr.write('Cannot inspect release'); process.exit(7); }
  process.stdout.write(JSON.stringify({ tag_name: 'v2.0.2', draft: false, prerelease: false, assets: JSON.parse(process.env.FAKE_GH_EXISTING) }));
} else if (args[0] === 'release' && args[1] === 'view') {
  process.stdout.write(JSON.stringify({ assets: JSON.parse(process.env.FAKE_GH_EXISTING) }));
} else if (args[1] === 'upload') {
  process.exit(Number(process.env.FAKE_GH_UPLOAD_STATUS || 0));
} else process.exit(9);
`, { mode: 0o755 });
  const assets = (options.names ?? assetNames).map(name => path.join(root, name));
  await Promise.all(assets.map(asset => writeFile(asset, path.extname(asset) === ".mcpb" ? fixtureArchive({
    "manifest.json": JSON.stringify({ name: "@ipgeolocation/ipgeolocation-io-mcp", version: "2.0.2" }),
    "server.json": "fixture", "sbom.cdx.json": "fixture",
  }) : "fixture")));
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    GITHUB_REPOSITORY: "IPGeolocation/ipgeolocation-io-mcp",
    GITHUB_SHA: "a".repeat(40),
    GITHUB_REF: "refs/tags/v2.0.2",
    SOURCE_REF: "v2.0.2",
    FAKE_GH_LOG: log,
    FAKE_GH_TAG_SHA: options.tagSha ?? "a".repeat(40),
    FAKE_GH_EXISTING: JSON.stringify((options.existing ?? []).map(name => ({ name }))),
    FAKE_GH_VIEW_FAIL: options.viewFail ? "1" : "",
    FAKE_GH_UPLOAD_STATUS: String(options.uploadStatus ?? 0),
  };
  return {
    root, assets,
    run: (input = assets) => spawnSync(process.execPath, [script, "v2.0.2", ...input], { env, encoding: "utf8" }),
    calls: async () => {
      try { return (await readFile(log, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse); }
      catch (error) { if (error.code === "ENOENT") return []; throw error; }
    },
  };
}

releaseCliTest("release assets are preflighted together and the bundle is uploaded last", async t => {
  const fixture = await setup(t, { existing: ["unrelated.txt"] });
  const result = fixture.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await fixture.calls(), [
    ...releaseInspection,
    ...[3, 4, 2, 1, 0].map(index => ["release", "upload", "v2.0.2", fixture.assets[index], "--repo", "IPGeolocation/ipgeolocation-io-mcp"]),
  ]);
});

releaseCliTest("a collision in any of the five asset names prevents every upload", async t => {
  for (const name of assetNames) {
    await t.test(name, async t => {
      const fixture = await setup(t, { existing: [name] });
      const result = fixture.run();
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Refusing to replace published release assets/);
      assert.ok(result.stderr.includes(name));
      assert.deepEqual(await fixture.calls(), releaseInspection);
    });
  }
});

releaseCliTest("failed asset inspection cannot fall through to upload", async t => {
  const fixture = await setup(t, { viewFail: true });
  const result = fixture.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cannot inspect release/);
  assert.deepEqual(await fixture.calls(), releaseInspection);
});

releaseCliTest("a tag moved after preflight is rejected before any asset upload", async t => {
  const fixture = await setup(t, { tagSha: "b".repeat(40) });
  const result = fixture.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /release tag does not match this workflow's source commit/);
  assert.deepEqual(await fixture.calls(), [releaseInspection[0]]);
});

releaseCliTest("a complete asset set with unexpected bundle filenames is rejected before any release request", async t => {
  const names = assetNames.map(name => name.replace("2.0.2.mcpb", "2.0.2-any-any.mcpb"));
  const fixture = await setup(t, { names });
  const result = fixture.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /filenames must match the configured bundle name and release tag/);
  assert.deepEqual(await fixture.calls(), []);
});

releaseCliTest("all local files must exist before querying or uploading", async t => {
  const fixture = await setup(t);
  await rm(fixture.assets.at(-1));
  assert.notEqual(fixture.run().status, 0);
  assert.deepEqual(await fixture.calls(), []);
});

releaseCliTest("duplicate destination filenames are rejected before any release request", async t => {
  const fixture = await setup(t);
  const duplicateDir = path.join(fixture.root, "duplicate");
  await mkdir(duplicateDir);
  const duplicate = path.join(duplicateDir, assetNames[0]);
  await writeFile(duplicate, "fixture");
  const result = fixture.run([...fixture.assets, duplicate]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /filenames must be unique/);
  assert.deepEqual(await fixture.calls(), []);
});

releaseCliTest("an upload failure is propagated without retrying or replacing assets", async t => {
  const fixture = await setup(t, { uploadStatus: 23 });
  assert.equal(fixture.run().status, 23);
  assert.equal((await fixture.calls()).length, 3);
});

test("release workflow uses the guarded upload and has no overwrite flag", async () => {
  const workflow = (await readFile(path.join(repo, ".github/workflows/mpak-release.yml"), "utf8")).replace(/\r\n/g, "\n");
  assert.match(workflow, /node scripts\/upload-mpak-release-assets\.mjs/);
  const finalization = workflow.indexOf("node scripts/finalize-mpak-bundle.mjs");
  assert.ok(finalization >= 0 && finalization < workflow.indexOf("cosign sign-blob"), "Manifest verification must complete before signing");
  assert.doesNotMatch(workflow, /--clobber|gh release upload/);
  assert.match(workflow, /^concurrency:\n  group: mpak-release-\$\{\{ inputs\.release_tag \}\}\n  cancel-in-progress: false$/m);
});

test("Docker build context excludes local credential files", async () => {
  const patterns = (await readFile(path.join(repo, ".dockerignore"), "utf8")).split(/\r?\n/);
  for (const pattern of ["**/.env", "**/.env.*", "**/.npmrc", "**/.npmrc.*", "**/.mcpregistry_*"]) {
    assert.ok(patterns.includes(pattern), `Missing credential exclusion: ${pattern}`);
  }
});

test("bundle resource controls match runtime names, defaults and bounds", async t => {
  const manifest = JSON.parse(await readFile(path.join(repo, "manifest.json"), "utf8"));
  const config = await import("../dist/config.js");
  const settings = [
    ["cache_max_bytes", "IPGEOLOCATION_MCP_CACHE_MAX_BYTES", config.getCacheMaxBytes, 33554432, 4194304, 1073741824],
    ["upstream_max_response_bytes", "IPGEOLOCATION_UPSTREAM_MAX_RESPONSE_BYTES", config.getMaxUpstreamBytes, 8388608, 1048576, 268435456],
    ["max_argument_bytes", "IPGEOLOCATION_MCP_MAX_ARGUMENT_BYTES", config.getMaxToolArgumentBytes, 4194304, 65536, 33554432],
  ];
  for (const [property, env, getValue, fallback, min, max] of settings) {
    const original = process.env[env];
    t.after(() => original === undefined ? delete process.env[env] : process.env[env] = original);
    assert.equal(manifest.server.mcp_config.env[env], "${user_config." + property + "}");
    const control = manifest.user_config[property];
    assert.equal(control.type, "number");
    assert.equal(control.required, undefined);
    assert.deepEqual([control.default, control.min, control.max], [fallback, min, max]);
    for (const [raw, expected] of [[undefined, fallback], [String(min), min], [String(max), max], [String(min - 1), fallback], [String(max + 1), fallback]]) {
      raw === undefined ? delete process.env[env] : process.env[env] = raw;
      assert.equal(getValue(), expected, env + "=" + raw);
    }
  }
});


async function packagingFixture(t) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "mpak-prepare-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixtureRepo = path.join(root, "repository");
  const bin = path.join(root, "bin");
  const log = path.join(root, "npm-call.json");
  await mkdir(bin, { recursive: true });
  const npmCli = path.join(root, "npm CLI fixture.mjs");
  await writeFile(npmCli, `import fs from 'node:fs'; const args=process.argv.slice(2); fs.appendFileSync(process.env.FAKE_NPM_LOG, JSON.stringify({ args, node: process.execPath, cwd: process.cwd() })+'\\n'); if(args[0]==='run'){if(process.env.FAKE_NPM_BUILD_STATUS)process.exit(Number(process.env.FAKE_NPM_BUILD_STATUS));fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/cli.js','// fresh selected-source build\\n');}else process.exit(Number(process.env.FAKE_NPM_STATUS || 0));`);
  await writeFile(path.join(bin, "npm"), `#!${process.execPath}\nprocess.exit(93);\n`, { mode: 0o755 });
  await writeFile(path.join(bin, "npm.cmd"), "@exit /b 93\r\n");
  async function makeSource(destination) {
    await mkdir(destination, { recursive: true });
    for (const file of ["package.json", "package-lock.json", "manifest.json", "server.json"]) {
      await cp(path.join(repo, file), path.join(destination, file));
    }
    for (const file of ["LICENSE", "README.md", "REFERENCE.md", "CHANGELOG.md", "SECURITY.md", "CONTRIBUTING.md", "RELEASING.md", "packaging/mpak/README.md", "packaging/kiro/README.md", "packaging/kiro/mcp.json", "packaging/kiro/plugin.json"]) {
      await mkdir(path.dirname(path.join(destination, file)), { recursive: true });
      await writeFile(path.join(destination, file), "Packaging fixture");
    }
    await writeFile(path.join(destination, "packaging/mpak/config.json"), JSON.stringify({ bundleName: "@fixture/server" }));
    await mkdir(path.join(destination, "dist"), { recursive: true });
    await writeFile(path.join(destination, "dist/cli.js"), "// fixture\n");
  }
  await makeSource(fixtureRepo);
  await mkdir(path.join(fixtureRepo, "scripts"));
  await mkdir(path.join(fixtureRepo, "artifacts"));
  const prepare = path.join(fixtureRepo, "scripts/prepare-mpak-package.mjs");
  await cp(path.join(repo, "scripts/prepare-mpak-package.mjs"), prepare);
  await cp(path.join(repo, "scripts/prepare-mpak-announcement.mjs"), path.join(fixtureRepo, "scripts/prepare-mpak-announcement.mjs"));
  const sbom = path.join(fixtureRepo, "scripts/generate-mpak-sbom.mjs");
  await cp(path.join(repo, "scripts/generate-mpak-sbom.mjs"), sbom);
  const syft = path.join(bin, "syft");
  const syftLog = path.join(root, "syft-call.json");
  await writeFile(syft, `#!${process.execPath}\n` + `
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.writeFileSync(process.env.FAKE_SYFT_LOG, JSON.stringify(args));
const destination = args[args.indexOf('--output') + 1].slice('cyclonedx-json='.length);
fs.writeFileSync(destination, JSON.stringify({bomFormat:'CycloneDX', specVersion:'1.6', components:[{type:'library', name:'fixture', version:'1', purl:'pkg:npm/fixture@1'}]}));
`, { mode: 0o755 });
  const output = path.join(fixtureRepo, "artifacts/output");
  const env = {
    ...process.env, PATH: bin, npm_execpath: npmCli,
    MPAK_SOURCE_DIR: fixtureRepo, MPAK_STAGING_DIR: output,
    FAKE_NPM_LOG: log, FAKE_NPM_STATUS: "0",
  };
  return {
    root, fixtureRepo, output, makeSource,
    run: (extra = {}) => spawnSync(process.execPath, [prepare], { env: { ...env, ...extra }, encoding: "utf8" }),
    runSbom: (staging) => spawnSync(process.execPath, [sbom, staging], {
      env: { ...env, SYFT_BIN: syft, FAKE_SYFT_LOG: syftLog }, encoding: "utf8",
    }),
    syftCalls: async () => { try { return JSON.parse(await readFile(syftLog, "utf8")); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; } },
    npmCall: async () => { try { return (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse).at(-1); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; } },
    npmCalls: async () => { try { return (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse); } catch (error) { if (error.code === "ENOENT") return []; throw error; } },
  };
}

test("mpak preparation invokes the npm JavaScript CLI through Node without a shell", async t => {
  const fixture = await packagingFixture(t);
  const result = fixture.run();
  assert.equal(result.status, 0, result.stderr);
  const call = await fixture.npmCall();
  assert.deepEqual(call.args, ["ci", "--omit=dev", "--ignore-scripts"]);
  assert.equal(call.node, process.execPath);
  assert.equal(call.cwd, fixture.output);
  const calls = await fixture.npmCalls();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], { args: ["run", "build"], node: process.execPath, cwd: fixture.fixtureRepo });
  const staged = JSON.parse(await readFile(path.join(fixture.output, "package.json"), "utf8"));
  assert.equal(staged.private, true);
  assert.ok(await readFile(path.join(fixture.output, "dist/cli.js"), "utf8"));
});

test("failed npm staging stops the preparation with a useful error", async t => {
  const fixture = await packagingFixture(t);
  const result = fixture.run({ FAKE_NPM_STATUS: "11" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /npm ci failed while preparing the mpak package/);
});

test("a failed source build leaves the previous staging package untouched", async t => {
  const fixture = await packagingFixture(t);
  await mkdir(fixture.output, { recursive: true });
  const sentinel = path.join(fixture.output, "keep.txt");
  await writeFile(sentinel, "previous staging package");
  const result = fixture.run({ FAKE_NPM_BUILD_STATUS: "17" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /npm run build failed while preparing the mpak package/);
  assert.equal(await readFile(sentinel, "utf8"), "previous staging package");
  assert.equal((await fixture.npmCalls()).length, 1);
});

test("mpak preparation refuses the artifacts root without deleting other artifacts", async t => {
  const fixture = await packagingFixture(t);
  const artifacts = path.join(fixture.fixtureRepo, "artifacts");
  const sentinel = path.join(artifacts, "keep.txt");
  await writeFile(sentinel, "keep");
  const result = fixture.run({ MPAK_STAGING_DIR: artifacts });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be a child/);
  assert.equal(await readFile(sentinel, "utf8"), "keep");
  assert.equal(await fixture.npmCall(), undefined);
});

test("mpak preparation cannot delete a source nested inside its output directory", async t => {
  const fixture = await packagingFixture(t);
  const output = path.join(fixture.fixtureRepo, "artifacts/holder");
  const source = path.join(output, "source");
  await fixture.makeSource(source);
  const sentinel = path.join(source, "keep.txt");
  await writeFile(sentinel, "keep");
  const result = fixture.run({ MPAK_SOURCE_DIR: source, MPAK_STAGING_DIR: output });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must not contain MPAK_SOURCE_DIR/);
  assert.equal(await readFile(sentinel, "utf8"), "keep");
  assert.equal(await fixture.npmCall(), undefined);
});

test("mpak staging cannot escape artifacts through a symlink or junction", async t => {
  const fixture = await packagingFixture(t);
  const external = path.join(fixture.root, "external");
  await mkdir(path.join(external, "output"), { recursive: true });
  const sentinel = path.join(external, "output/keep.txt");
  await writeFile(sentinel, "keep");
  const link = path.join(fixture.fixtureRepo, "artifacts/link");
  await symlink(external, link, process.platform === "win32" ? "junction" : "dir");
  const result = fixture.run({ MPAK_STAGING_DIR: path.join(link, "output") });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /without escaping through a symlink/);
  assert.equal(await readFile(sentinel, "utf8"), "keep");
  assert.equal(await fixture.npmCall(), undefined);
});

releaseCliTest("SBOM generation accepts a physical staged package", async t => {
  const fixture = await packagingFixture(t);
  await fixture.makeSource(fixture.output);
  const result = fixture.runSbom(fixture.output);
  assert.equal(result.status, 0, result.stderr);
  const sbom = JSON.parse(await readFile(path.join(fixture.output, "sbom.cdx.json"), "utf8"));
  assert.equal(sbom.specVersion, "1.6");
  assert.equal(sbom.metadata.component.name, "ipgeolocation-io-mcp");
  assert.ok(await fixture.syftCalls());
});

test("SBOM generation rejects the artifacts root before touching existing files", async t => {
  const fixture = await packagingFixture(t);
  const artifacts = path.join(fixture.fixtureRepo, "artifacts");
  const sentinel = path.join(artifacts, "sbom.cdx.json");
  await writeFile(sentinel, "keep");
  const result = fixture.runSbom(artifacts);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be a child/);
  assert.equal(await readFile(sentinel, "utf8"), "keep");
  assert.equal(await fixture.syftCalls(), undefined);
});

test("SBOM generation rejects a staging symlink outside artifacts", async t => {
  const fixture = await packagingFixture(t);
  const external = path.join(fixture.root, "external");
  await fixture.makeSource(external);
  const sentinel = path.join(external, "sbom.cdx.json");
  await writeFile(sentinel, "keep");
  const link = path.join(fixture.fixtureRepo, "artifacts/link");
  await symlink(external, link, process.platform === "win32" ? "junction" : "dir");
  const result = fixture.runSbom(link);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /without escaping through a symlink/);
  assert.equal(await readFile(sentinel, "utf8"), "keep");
  assert.equal(await fixture.syftCalls(), undefined);
});

test("SBOM generation rejects a symlinked artifacts directory", async t => {
  const fixture = await packagingFixture(t);
  const external = path.join(fixture.root, "external");
  const output = path.join(external, "output");
  await fixture.makeSource(output);
  const sentinel = path.join(output, "sbom.cdx.json");
  await writeFile(sentinel, "keep");
  const artifacts = path.join(fixture.fixtureRepo, "artifacts");
  await rm(artifacts, {recursive: true});
  await symlink(external, artifacts, process.platform === "win32" ? "junction" : "dir");
  const result = fixture.runSbom(path.join(artifacts, "output"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /without escaping through a symlink/);
  assert.equal(await readFile(sentinel, "utf8"), "keep");
  assert.equal(await fixture.syftCalls(), undefined);
});
