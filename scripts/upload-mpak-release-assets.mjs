import { spawnSync } from "node:child_process";
import path from "node:path";
import { localAssetMetadata, publishedAsset, readRelease, releaseContext, run, verifyLocalBundle } from "./prepare-mpak-announcement.mjs";

const args = process.argv.slice(2);
const mode = args[0]?.startsWith("--") ? args.shift() : "upload";
const [releaseTag, ...assets] = args;
if (!["upload", "--preflight", "--resume"].includes(mode) || !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(releaseTag ?? "") || releaseTag !== releaseTag?.trim()) {
  throw new Error("Usage: node scripts/upload-mpak-release-assets.mjs [--preflight|--resume] <release-tag> <asset>...");
}

if (mode === "--preflight") {
  if (assets.length) throw new Error("Preflight derives the five release filenames from the configured bundle name and tag.");
  const context = releaseContext(releaseTag), release = readRelease(context);
  const conflicts = release.assets.filter(asset => context.names.includes(asset.name));
  if (conflicts.length) throw new Error("Release assets already exist. Use verified resume for missing assets or announce for a complete release; do not rebuild or replace signed bytes.");
  console.log("All five release filenames are available before building or signing.");
} else {
  if (!assets.length) throw new Error("Supply the complete local asset set, or its directory with --resume.");
  let files, release, metadata, repository;
  if (mode === "--resume") {
    if (assets.length !== 1) throw new Error("Resume accepts one directory containing the retained five-file asset set.");
    const context = releaseContext(releaseTag);
    repository = context.repository;
    release = readRelease(context);
    const verified = await verifyLocalBundle(context, path.resolve(assets[0]));
    metadata = verified.metadata;
    files = context.names.map(name => path.join(path.resolve(assets[0]), name));
  } else {
    files = assets.map(file => path.resolve(file));
    metadata = new Map();
    for (const file of files) {
      const name = path.basename(file);
      if (metadata.has(name)) throw new Error("Release asset filenames must be unique.");
      metadata.set(name, await localAssetMetadata(file));
    }
    const bundles = [...metadata.keys()].filter(name => name.endsWith(".mcpb"));
    const required = bundles.length === 1 ? [`${bundles[0]}.sigstore.json`, `${bundles[0]}.provenance.sigstore.json`, "sbom.cdx.json", "server.json", bundles[0]] : [];
    if (required.length !== 5 || metadata.size !== 5 || required.some(name => !metadata.has(name))) {
      throw new Error("Supply one bundle, its signature and provenance, sbom.cdx.json and server.json together.");
    }
    files.sort((left, right) => required.indexOf(path.basename(left)) - required.indexOf(path.basename(right)));
    try { release = JSON.parse(run("gh", ["release", "view", releaseTag, "--json", "assets"])); }
    catch (error) { throw new Error(`Unable to inspect release assets: ${error.message}`); }
    if (!Array.isArray(release.assets)) throw new Error("Unable to inspect release assets.");
    const conflicts = [...metadata.keys()].filter(name => release.assets.some(asset => asset.name === name));
    if (conflicts.length) throw new Error(`Refusing to replace published release assets: ${conflicts.join(", ")}`);
  }

  const missing = [];
  for (const file of files) {
    const name = path.basename(file);
    const existing = publishedAsset(release, name, false);
    if (!existing) { missing.push(file); continue; }
    const expected = metadata.get(name);
    if (existing.size !== expected.size || existing.digest.toLowerCase() !== expected.digest) {
      throw new Error(`Published bytes differ from the retained asset set: ${name}. Nothing was uploaded.`);
    }
  }
  // A discoverable bundle is uploaded only after every verification sidecar succeeds.
  for (const file of missing) {
    const upload = spawnSync("gh", ["release", "upload", releaseTag, file, ...(repository ? ["--repo", repository] : [])], { stdio: "inherit" });
    if (upload.error) throw upload.error;
    if (upload.status !== 0) process.exit(upload.status ?? 1);
  }
  console.log(`Uploaded ${missing.length} missing release asset${missing.length === 1 ? "" : "s"} without replacing existing bytes.`);
}
