import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const [, , bundlePathArg, stagingDirArg] = process.argv;

if (!bundlePathArg || !stagingDirArg) {
  throw new Error("Usage: node scripts/finalize-mpak-bundle.mjs <bundle-path> <staging-dir>");
}

const bundlePath = path.resolve(bundlePathArg);
const stagingDir = path.resolve(stagingDirArg);

if (!existsSync(bundlePath)) {
  throw new Error(`Bundle not found: ${bundlePath}`);
}

if (!existsSync(stagingDir)) {
  throw new Error(`Staging directory not found: ${stagingDir}`);
}

const requiredStagingEntries = [
  "LICENSE",
  "README.md",
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

const listing = spawnSync("unzip", ["-Z1", bundlePath], {
  encoding: "utf8",
});

if (listing.error) {
  throw new Error(`Unable to inspect the mpak bundle: ${listing.error.message}`);
}

if (listing.status !== 0) {
  throw new Error(
    `Unable to list mpak bundle contents.\n${listing.stderr || listing.stdout}`,
  );
}

const bundleEntries = new Set(listing.stdout.split(/\r?\n/u).filter(Boolean));
for (const entry of requiredStagingEntries) {
  if (!bundleEntries.has(entry)) {
    throw new Error(`Required file is missing from the mpak bundle: ${entry}`);
  }
}

console.log(`Verified ${requiredStagingEntries.length} required mpak bundle entries.`);
