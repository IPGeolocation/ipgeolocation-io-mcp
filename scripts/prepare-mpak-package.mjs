import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
const licensePath = path.join(sourceDir, "LICENSE");

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

const rootPackage = readJson(path.join(sourceDir, "package.json"));
const rootLockfile = readJson(path.join(sourceDir, "package-lock.json"));
const rootManifest = readJson(path.join(sourceDir, "manifest.json"));
const rootServerMetadata = readJson(path.join(sourceDir, "server.json"));
const mpakConfig = readJson(path.join(packagingDir, "config.json"));
const version = rootPackage.version;

if (
  sourceDir !== repoRoot &&
  sourceDir !== workspaceRoot &&
  !sourceDir.startsWith(`${repoRoot}${path.sep}`) &&
  !sourceDir.startsWith(`${workspaceRoot}${path.sep}`)
) {
  throw new Error(
    "MPAK_SOURCE_DIR must stay within the repository or the GitHub Actions workspace.",
  );
}

if (
  outputDir !== artifactsRoot &&
  !outputDir.startsWith(`${artifactsRoot}${path.sep}`)
) {
  throw new Error("MPAK_STAGING_DIR must stay within the repository artifacts/ directory.");
}

if (!existsSync(distDir)) {
  throw new Error("Missing dist/. Run npm run build before preparing the mpak package.");
}

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

if (existsSync(licensePath)) {
  cpSync(licensePath, path.join(outputDir, "LICENSE"));
}
