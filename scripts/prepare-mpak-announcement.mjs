import { createHash } from "node:crypto";
import { createReadStream, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function run(command, args, encoding = "utf8", maxBuffer = 1024 * 1024) {
  const result = spawnSync(command, args, { encoding, maxBuffer });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.error?.message || result.stderr || result.stdout}`);
  return result.stdout;
}

export function releaseContext(releaseTag) {
  const repository = process.env.GITHUB_REPOSITORY;
  const sourceDigest = process.env.GITHUB_SHA;
  const sourceRef = process.env.GITHUB_REF;
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(releaseTag ?? "") || releaseTag !== releaseTag?.trim()) {
    throw new Error("A v-prefixed release version is required.");
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "") || repository !== repository?.trim() || !/^[a-f0-9]{40}$/i.test(sourceDigest ?? "") || sourceDigest !== sourceDigest?.trim()) {
    throw new Error("A GitHub repository and source commit are required to verify the published bundle.");
  }
  if (sourceRef !== `refs/tags/${releaseTag}` || process.env.SOURCE_REF !== releaseTag) {
    throw new Error("Dispatch this workflow from the same tag supplied as source_ref and release_tag.");
  }
  const config = JSON.parse(readFileSync(new URL("../packaging/mpak/config.json", import.meta.url), "utf8"));
  if (!/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(config.bundleName ?? "") || config.bundleName !== config.bundleName.trim()) {
    throw new Error("The mpak bundle name must be a scoped package name.");
  }
  const version = releaseTag.slice(1);
  const filename = `${config.bundleName.slice(1).replace("/", "-")}-${version}.mcpb`;
  return { releaseTag, repository, sourceDigest, sourceRef, version, filename, bundleName: config.bundleName,
    names: [`${filename}.sigstore.json`, `${filename}.provenance.sigstore.json`, "sbom.cdx.json", "server.json", filename] };
}

export function readRelease(context) {
  const endpoint = `repos/${context.repository}`;
  const commit = JSON.parse(run("gh", ["api", `${endpoint}/commits/${encodeURIComponent(context.sourceRef)}`]));
  if (commit.sha !== context.sourceDigest) throw new Error("The current release tag does not match this workflow's source commit.");
  const release = JSON.parse(run("gh", ["api", `${endpoint}/releases/tags/${encodeURIComponent(context.releaseTag)}`]));
  if (release.tag_name !== context.releaseTag || release.draft !== false || typeof release.prerelease !== "boolean" || !Array.isArray(release.assets)) {
    throw new Error("The published release metadata does not match the requested tag.");
  }
  return release;
}

export async function localAssetMetadata(file) {
  const stats = lstatSync(file);
  if (!stats.isFile() || stats.size < 1) throw new Error(`Release asset is not a non-empty regular file: ${path.basename(file)}`);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return { size: stats.size, digest: `sha256:${hash.digest("hex")}` };
}

export function publishedAsset(release, name, required = true) {
  const matches = release.assets.filter(asset => asset.name === name);
  if (!required && matches.length === 0) return undefined;
  if (matches.length !== 1 || matches[0].state !== "uploaded" || !Number.isSafeInteger(matches[0].size) || matches[0].size < 1 || !/^sha256:[a-f0-9]{64}$/i.test(matches[0].digest ?? "")) {
    throw new Error(`Published asset metadata is missing or invalid: ${name}`);
  }
  return matches[0];
}

export const MAX_MANIFEST_BYTES = 1024 * 1024;

export function parseBundleManifest(bytes, context) {
  if (!/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(context.bundleName ?? "") ||
      context.bundleName !== context.bundleName?.trim() ||
      !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(context.version ?? "") ||
      context.version !== context.version?.trim()) {
    throw new Error("Manifest verification requires the configured scoped package name and source version.");
  }
  if (bytes.length > MAX_MANIFEST_BYTES) throw new Error("The bundle manifest exceeds the 1 MiB limit.");
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
  } catch {
    throw new Error("The bundle manifest must contain a valid JSON object.");
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("The bundle manifest must contain a valid JSON object.");
  }
  if (manifest.name !== context.bundleName || manifest.version !== context.version) {
    throw new Error("The bundle manifest does not match the configured package name and source version.");
  }
  return manifest;
}

export function bundleDocuments(sourceDir, sourcePackage) {
  const documents = ["README.md", "CHANGELOG.md", "SECURITY.md", "CONTRIBUTING.md", "RELEASING.md", "packaging/mpak/README.md"];
  if (existsSync(path.join(sourceDir, "packaging/kiro")) || (Array.isArray(sourcePackage.files) && sourcePackage.files.some(name => /^packaging\/kiro(?:\/|$)/u.test(name)))) {
    documents.push("packaging/kiro/README.md", "packaging/kiro/mcp.json", "packaging/kiro/plugin.json");
  }
  return documents;
}

export function listBundleEntries(bundlePath) {
  const listing = spawnSync("unzip", ["-Z1", bundlePath], {
    maxBuffer: 1024 * 1024,
    env: { ...process.env, LC_ALL: process.platform === "darwin" ? "en_US.UTF-8" : "C.UTF-8" },
  });
  if (listing.error || listing.status !== 0) throw new Error(`Unable to list mpak bundle contents.\n${listing.error?.message || listing.stderr || listing.stdout}`);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(listing.stdout);
  } catch {
    throw new Error("Unable to read bundle paths as UTF-8.");
  }
  const entries = text.split(/\r?\n/u).filter(Boolean);
  const paths = new Map();
  for (const entry of entries) {
    const directory = entry.endsWith("/");
    const name = directory ? entry.slice(0, -1) : entry;
    const segments = name.split("/");
    if (!name || path.posix.isAbsolute(name) || path.posix.normalize(name) !== name ||
        /[\\<>:"|?*\x00-\x1f\x7f]/u.test(name) || segments.some(part => !part || part === ".." || /[. ]$/u.test(part) || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part))) {
      throw new Error(`The bundle contains a noncanonical path: ${entry}`);
    }
    let children = paths;
    for (const [index, part] of segments.entries()) {
      const key = part.normalize("NFC").toUpperCase().toLowerCase();
      let existing = children.get(key);
      if (existing && existing.name !== part) throw new Error(`The bundle contains conflicting paths: ${existing.name} and ${entry}`);
      if (!existing) {
        existing = { name: part, listed: false, file: false, children: new Map() };
        children.set(key, existing);
      }
      if (index === segments.length - 1) {
        if (existing.listed) throw new Error(`The bundle must contain exactly one ${name}; it appears more than once.`);
        if (!directory && existing.children.size) throw new Error(`The bundle uses a file as a directory path: ${entry}`);
        existing.listed = true;
        existing.file = !directory;
      } else if (existing.file) {
        throw new Error(`The bundle uses a file as a directory path: ${entry}`);
      }
      children = existing.children;
    }
  }
  return entries;
}

export function verifyBundleManifest(bundlePath, context) {
  const entries = listBundleEntries(bundlePath);
  if (entries.filter(name => name === "manifest.json").length !== 1) {
    throw new Error("The bundle must contain exactly one manifest.json.");
  }
  const embedded = spawnSync("unzip", ["-p", bundlePath, "manifest.json"], { maxBuffer: MAX_MANIFEST_BYTES });
  if (embedded.error || embedded.status !== 0) throw new Error("Unable to read the bundle manifest within the 1 MiB limit.");
  return parseBundleManifest(embedded.stdout, context);
}

export function verifyBundleMetadata(bundlePath, sidecars) {
  const names = ["server.json", "sbom.cdx.json"];
  const entries = listBundleEntries(bundlePath);
  for (const name of names) {
    if (entries.filter(entry => entry === name).length !== 1) {
      throw new Error(`The bundle must contain exactly one ${name}.`);
    }
    const expected = readFileSync(sidecars[name]);
    const embedded = spawnSync("unzip", ["-p", bundlePath, name], { maxBuffer: Math.max(1024 * 1024, expected.length + 1) });
    if (embedded.error || embedded.status !== 0) throw new Error(`Unable to read bundled metadata: ${name}.`);
    if (!embedded.stdout.equals(expected)) throw new Error(`Release metadata does not match the bundle: ${name}.`);
  }
}

export async function verifyLocalBundle(context, directory) {
  const metadata = new Map();
  for (const name of context.names) metadata.set(name, await localAssetMetadata(path.join(directory, name)));
  const bundlePath = path.join(directory, context.filename);
  const identity = `https://github.com/${context.repository}/.github/workflows/mpak-release.yml@${context.sourceRef}`;
  run("cosign", ["verify-blob", "--bundle", `${bundlePath}.sigstore.json`, "--certificate-oidc-issuer", "https://token.actions.githubusercontent.com", "--certificate-identity", identity, bundlePath]);
  run("gh", ["attestation", "verify", bundlePath, "--repo", context.repository, "--bundle", `${bundlePath}.provenance.sigstore.json`, "--cert-identity", identity, "--source-ref", context.sourceRef, "--source-digest", context.sourceDigest]);
  const manifest = verifyBundleManifest(bundlePath, context);
  verifyBundleMetadata(bundlePath, { "server.json": path.join(directory, "server.json"), "sbom.cdx.json": path.join(directory, "sbom.cdx.json") });
  return { manifest, metadata };
}

async function prepareAnnouncement(releaseTag, directory) {
  if (!directory) throw new Error("A new download directory is required.");
  const context = releaseContext(releaseTag);
  const release = readRelease(context);
  const assets = context.names.map(name => publishedAsset(release, name));
  const outputDir = path.resolve(directory);
  mkdirSync(outputDir);
  run("gh", ["release", "download", releaseTag, "--repo", context.repository, "--dir", outputDir, ...context.names.flatMap(name => ["--pattern", name])]);
  for (const asset of assets) {
    const actual = await localAssetMetadata(path.join(outputDir, asset.name));
    if (actual.size !== asset.size) throw new Error(`Published asset size does not match: ${asset.name}`);
    if (actual.digest !== asset.digest.toLowerCase()) throw new Error(`Published asset checksum does not match: ${asset.name}`);
  }
  const { manifest, metadata } = await verifyLocalBundle(context, outputDir);
  const bundle = metadata.get(context.filename);
  const payload = {
    name: manifest.name, version: context.version, manifest, release_tag: releaseTag, prerelease: release.prerelease,
    artifact: { filename: context.filename, os: "any", arch: "any", sha256: bundle.digest.slice(7), size: bundle.size },
  };
  writeFileSync(path.join(outputDir, "announcement.json"), `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Prepared verified announcement for ${manifest.name} ${context.version}.`);
}

async function restoreAssets(releaseTag, runId, directory) {
  if (!/^[1-9]\d*$/.test(runId ?? "") || runId !== runId.trim() || !Number.isSafeInteger(Number(runId)) || !directory) {
    throw new Error("Recovery requires the original workflow run ID and a new download directory.");
  }
  const context = releaseContext(releaseTag);
  readRelease(context);
  const original = JSON.parse(run("gh", ["api", `repos/${context.repository}/actions/runs/${runId}`]));
  if (String(original.id) !== runId || original.repository?.full_name !== context.repository || original.head_sha !== context.sourceDigest || original.head_branch !== releaseTag || original.path?.split("@")[0] !== ".github/workflows/mpak-release.yml" || original.event !== "workflow_dispatch" || original.status !== "completed") {
    throw new Error("The recovery run must be a completed mpak release dispatch for this repository, tag and commit.");
  }
  const outputDir = path.resolve(directory);
  mkdirSync(outputDir);
  run("gh", ["run", "download", runId, "--repo", context.repository, "--name", "mpak-release-assets", "--dir", outputDir]);
  await verifyLocalBundle(context, outputDir);
  console.log(`Restored and verified the retained assets for ${releaseTag}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [first, ...args] = process.argv.slice(2);
  if (first === "--restore" && args.length === 3) await restoreAssets(...args);
  else if (first !== "--restore" && args.length === 1) await prepareAnnouncement(first, ...args);
  else throw new Error("Usage: node scripts/prepare-mpak-announcement.mjs <release-tag> <new-directory>, or --restore <release-tag> <run-id> <new-directory>");
}
