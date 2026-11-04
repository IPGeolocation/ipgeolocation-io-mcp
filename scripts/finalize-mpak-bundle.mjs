import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_MANIFEST_BYTES, bundleDocuments, listBundleEntries, parseBundleManifest, verifyBundleManifest, verifyBundleMetadata } from "./prepare-mpak-announcement.mjs";

const [, , bundlePathArg, stagingDirArg] = process.argv;

if (!bundlePathArg || !stagingDirArg) {
  throw new Error("Usage: node scripts/finalize-mpak-bundle.mjs <bundle-path> <staging-dir>");
}

const bundlePath = path.resolve(bundlePathArg);
const stagingDir = path.resolve(stagingDirArg);
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceDir = process.env.MPAK_SOURCE_DIR ? path.resolve(repoRoot, process.env.MPAK_SOURCE_DIR) : repoRoot;
const sourcePackage = JSON.parse(readFileSync(path.join(sourceDir, "package.json"), "utf8"));
const { version } = sourcePackage;
const { bundleName } = JSON.parse(readFileSync(path.join(repoRoot, "packaging/mpak/config.json"), "utf8"));
const context = { bundleName, version };

if (!existsSync(bundlePath)) {
  throw new Error(`Bundle not found: ${bundlePath}`);
}

if (!existsSync(stagingDir)) {
  throw new Error(`Staging directory not found: ${stagingDir}`);
}

const requiredStagingEntries = [
  "LICENSE",
  ...bundleDocuments(sourceDir, sourcePackage),
  "icon.png",
  "manifest.json",
  "package-lock.json",
  "package.json",
  "sbom.cdx.json",
  "server.json",
];

for (const entry of requiredStagingEntries) {
  if (!existsSync(path.join(stagingDir, entry))) {
    throw new Error(`Required mpak file is missing from staging: ${entry}`);
  }
}

const manifestPath = path.join(stagingDir, "manifest.json");
const manifestStats = lstatSync(manifestPath);
if (!manifestStats.isFile() || manifestStats.size > MAX_MANIFEST_BYTES) {
  throw new Error("The staged manifest must be a regular file within the 1 MiB limit.");
}
parseBundleManifest(readFileSync(manifestPath), context);

const bundleEntries = listBundleEntries(bundlePath);
for (const entry of requiredStagingEntries) {
  if (!bundleEntries.includes(entry)) {
    throw new Error(`Required file is missing from the mpak bundle: ${entry}`);
  }
  if (bundleEntries.filter(name => name === entry).length !== 1) {
    throw new Error(`Required file appears more than once in the mpak bundle: ${entry}`);
  }
}

verifyBundleManifest(bundlePath, context);
verifyBundleMetadata(bundlePath, { "server.json": path.join(stagingDir, "server.json"), "sbom.cdx.json": path.join(stagingDir, "sbom.cdx.json") });

console.log(`Verified ${requiredStagingEntries.length} required mpak bundle entries.`);
