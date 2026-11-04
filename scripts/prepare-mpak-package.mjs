import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleDocuments } from "./prepare-mpak-announcement.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const workspaceRoot = path.resolve(repoRoot, "..");
const artifactsRoot = path.join(repoRoot, "artifacts");
const requestedSourceDir = process.env.MPAK_SOURCE_DIR
  ? path.resolve(repoRoot, process.env.MPAK_SOURCE_DIR)
  : repoRoot;
const requestedOutputDir = process.env.MPAK_STAGING_DIR
  ? path.resolve(repoRoot, process.env.MPAK_STAGING_DIR)
  : path.join(artifactsRoot, "mpak-package");
const sourceDir = requestedSourceDir;
const outputDir = requestedOutputDir;
const packagingDir = path.join(repoRoot, "packaging", "mpak");
const distDir = path.join(sourceDir, "dist");
const iconPath = path.join(sourceDir, "icon.png");
const licensePath = path.join(sourceDir, "LICENSE");
const mcpbignoreTemplatePath = path.join(packagingDir, "mcpbignore.template");

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function buildStagingPackageJson(rootPackage) {
  return {
    name: "@ipgeolocation/ipgeolocation-io-mcp-mpak-staging",
    private: true,
    version: "0.0.0-mpak",
    type: rootPackage.type,
    license: rootPackage.license,
    engines: rootPackage.engines,
    dependencies: rootPackage.dependencies,
    overrides: rootPackage.overrides ?? {},
    bundledDependencies: Object.keys(rootPackage.dependencies),
  };
}

function buildStagingLockfile(rootLockfile) {
  const stagingLockfile = structuredClone(rootLockfile);
  const rootEntry = stagingLockfile.packages?.[""];

  stagingLockfile.name = "@ipgeolocation/ipgeolocation-io-mcp-mpak-staging";
  stagingLockfile.version = "0.0.0-mpak";

  if (rootEntry) {
    rootEntry.name = "@ipgeolocation/ipgeolocation-io-mcp-mpak-staging";
    rootEntry.version = "0.0.0-mpak";
    delete rootEntry.bin;
    delete rootEntry.devDependencies;
  }

  return stagingLockfile;
}

function buildStagingManifest(rootManifest, version, bundleName) {
  const stagingManifest = structuredClone(rootManifest);
  stagingManifest.name = bundleName;
  stagingManifest.version = version;
  stagingManifest.manifest_version = "0.4";
  return stagingManifest;
}

function buildStagingServer(rootServerMetadata, rootManifest, version, bundleName) {
  const repositoryUrl = rootServerMetadata.repository?.url ?? rootManifest.repository?.url;
  return {
    name: bundleName,
    title: rootServerMetadata.title ?? rootManifest.display_name,
    description: rootServerMetadata.description ?? rootManifest.description,
    version,
    repository: repositoryUrl
      ? {
          url: repositoryUrl,
          source: repositoryUrl,
        }
      : undefined,
  };
}

function runNpm(directory, args) {
  const npmCli = process.env.npm_execpath;
  if (process.platform === "win32" && !npmCli) {
    throw new Error("On Windows, run npm run prepare:mpak so npm_execpath identifies the npm JavaScript CLI.");
  }
  const result = spawnSync(
    npmCli ? process.execPath : "npm",
    [...(npmCli ? [npmCli] : []), ...args],
    {
      cwd: directory,
      encoding: "utf8",
    },
  );

  if (result.status !== 0) {
    const command = args[0] === "run" ? `npm run ${args[1]}` : `npm ${args[0]}`;
    throw new Error(
      `${command} failed while preparing the mpak package.\n${result.error?.message || result.stderr || result.stdout}`,
    );
  }
}

function pruneBundledDependencyNoise(outputDir) {
  const nodeModulesDir = path.join(outputDir, "node_modules");
  const ignoredDirectoryNames = new Set([
    ".github",
    "docs",
    "doc",
    "examples",
    "test",
    "tests",
    "__tests__",
  ]);
  const ignoredFilePattern = /^(readme|changelog|history)/i;

  if (!existsSync(nodeModulesDir) || lstatSync(nodeModulesDir).isSymbolicLink()) {
    return;
  }

  function walk(currentPath) {
    for (const entry of readdirSync(currentPath)) {
      const entryPath = path.join(currentPath, entry);
      const entryStats = lstatSync(entryPath);
      if (entryStats.isSymbolicLink()) continue;

      if (entryStats.isDirectory()) {
        if (ignoredDirectoryNames.has(entry)) {
          rmSync(entryPath, { recursive: true, force: true });
          continue;
        }

        walk(entryPath);
        continue;
      }

      if (ignoredFilePattern.test(entry)) {
        rmSync(entryPath, { force: true });
      }
    }
  }

  walk(nodeModulesDir);
}

const rootPackage = readJson(path.join(sourceDir, "package.json"));
const rootLockfile = readJson(path.join(sourceDir, "package-lock.json"));
const rootManifest = readJson(path.join(sourceDir, "manifest.json"));
const rootServerMetadata = readJson(path.join(sourceDir, "server.json"));
const mpakConfig = readJson(path.join(packagingDir, "config.json"));
const version = rootPackage.version;

const physicalSource = realpathSync(sourceDir);
const physicalRepo = realpathSync(repoRoot);
const physicalWorkspace = realpathSync(workspaceRoot);
if (![physicalRepo, physicalWorkspace].some(parent => path.relative(parent, physicalSource) === "" || isChild(parent, physicalSource))) {
  throw new Error(
    "MPAK_SOURCE_DIR must stay within the repository or the GitHub Actions workspace.",
  );
}

function isChild(parent, target) {
  const relative = path.relative(parent, target);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function physicalPath(target) {
  if (existsSync(target)) return realpathSync(target);
  return path.join(physicalPath(path.dirname(target)), path.basename(target));
}

if (!isChild(artifactsRoot, outputDir)) throw new Error("MPAK_STAGING_DIR must be a child of the repository artifacts/ directory.");
const physicalOutput = physicalPath(outputDir);
const physicalArtifacts = path.join(physicalRepo, "artifacts");
if (!isChild(physicalArtifacts, physicalOutput)) {
  throw new Error("MPAK_STAGING_DIR must be a child of the repository artifacts/ directory without escaping through a symlink.");
}
if (path.relative(physicalOutput, physicalSource) === "" || isChild(physicalOutput, physicalSource)) {
  throw new Error("MPAK_STAGING_DIR must not contain MPAK_SOURCE_DIR.");
}

const documents = bundleDocuments(sourceDir, rootPackage);
for (const name of documents) {
  if (!existsSync(path.join(sourceDir, name))) throw new Error(`Required mpak source file is missing: ${name}`);
}

// Build the selected source; a previous dist directory may contain removed files.
rmSync(distDir, { recursive: true, force: true });
runNpm(sourceDir, ["run", "build"]);
if (!existsSync(distDir)) throw new Error("The source build did not create dist/. Nothing was staged.");

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

writeJson(path.join(outputDir, "package.json"), buildStagingPackageJson(rootPackage));
writeJson(path.join(outputDir, "package-lock.json"), buildStagingLockfile(rootLockfile));
writeJson(
  path.join(outputDir, "manifest.json"),
  buildStagingManifest(rootManifest, version, mpakConfig.bundleName),
);
writeJson(
  path.join(outputDir, "server.json"),
  buildStagingServer(rootServerMetadata, rootManifest, version, mpakConfig.bundleName),
);

cpSync(distDir, path.join(outputDir, "dist"), { recursive: true });
runNpm(outputDir, ["ci", "--omit=dev", "--ignore-scripts"]);
pruneBundledDependencyNoise(outputDir);
if (existsSync(licensePath)) {
  cpSync(licensePath, path.join(outputDir, "LICENSE"));
}

for (const name of documents) {
  const destination = path.join(outputDir, name);
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(path.join(sourceDir, name), destination);
}

if (existsSync(iconPath)) {
  cpSync(iconPath, path.join(outputDir, "icon.png"));
}

if (existsSync(mcpbignoreTemplatePath)) {
  cpSync(mcpbignoreTemplatePath, path.join(outputDir, ".mcpbignore"));
}
