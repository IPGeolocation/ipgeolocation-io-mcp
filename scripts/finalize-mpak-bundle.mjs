import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const [, , bundlePathArg, stagingDirArg] = process.argv;

if (!bundlePathArg || !stagingDirArg) {
  throw new Error("Usage: node scripts/finalize-mpak-bundle.mjs <bundle-path> <staging-dir>");
}

const bundlePath = path.resolve(bundlePathArg);
const stagingDir = path.resolve(stagingDirArg);
const lockfilePath = path.join(stagingDir, "deps", "package-lock.json");

if (!existsSync(bundlePath)) {
  throw new Error(`Bundle not found: ${bundlePath}`);
}

if (!existsSync(lockfilePath)) {
  throw new Error(`Lockfile not found: ${lockfilePath}`);
}

const zipBin = process.platform === "win32" ? "zip.exe" : "zip";
const result = spawnSync(zipBin, ["-q", bundlePath, "deps/package-lock.json"], {
  cwd: stagingDir,
  encoding: "utf8",
});

if (result.status !== 0) {
  throw new Error(`Failed to update mpak bundle.\n${result.stderr || result.stdout}`);
}
