import { spawnSync } from "node:child_process";
import path from "node:path";
import { localAssetMetadata, publishedAsset, readRelease, releaseContext, verifyBundleManifest, verifyBundleMetadata, verifyLocalBundle } from "./prepare-mpak-announcement.mjs";

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
  const context = releaseContext(releaseTag);
  let files, release, metadata;
  if (mode === "--resume") {
    if (assets.length !== 1) throw new Error("Resume accepts one directory containing the retained five-file asset set.");
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
    if (metadata.size !== context.names.length || context.names.some(name => !metadata.has(name))) {
      throw new Error("Release asset filenames must match the configured bundle name and release tag.");
    }
    const localPaths = Object.fromEntries(files.map(file => [path.basename(file), file]));
    verifyBundleManifest(localPaths[context.filename], context);
    verifyBundleMetadata(localPaths[context.filename], localPaths);
    files.sort((left, right) => context.names.indexOf(path.basename(left)) - context.names.indexOf(path.basename(right)));
    release = readRelease(context);
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
    const upload = spawnSync("gh", ["release", "upload", releaseTag, file, "--repo", context.repository], { stdio: "inherit" });
    if (upload.error) throw upload.error;
    if (upload.status !== 0) process.exit(upload.status ?? 1);
  }
  console.log(`Uploaded ${missing.length} missing release asset${missing.length === 1 ? "" : "s"} without replacing existing bytes.`);
}
