import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { verifyBundleMetadata } from "./prepare-mpak-announcement.mjs";

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
  "CHANGELOG.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "RELEASING.md",
  "packaging/mpak/README.md",
  "packaging/kiro/README.md",
  "packaging/kiro/mcp.json",
  "packaging/kiro/plugin.json",
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

const bundleEntries = listing.stdout.split(/\r?\n/u).filter(Boolean);
for (const entry of requiredStagingEntries) {
  if (!bundleEntries.includes(entry)) {
    throw new Error(`Required file is missing from the mpak bundle: ${entry}`);
  }
  if (bundleEntries.filter(name => name === entry).length !== 1) {
    throw new Error(`Required file appears more than once in the mpak bundle: ${entry}`);
  }
}

verifyBundleMetadata(bundlePath, { "server.json": path.join(stagingDir, "server.json"), "sbom.cdx.json": path.join(stagingDir, "sbom.cdx.json") });

console.log(`Verified ${requiredStagingEntries.length} required mpak bundle entries.`);
