import {
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const artifactsRoot = path.join(repoRoot, "artifacts");
const requestedStagingDir = process.argv[2]
  ? path.resolve(repoRoot, process.argv[2])
  : path.join(artifactsRoot, "mpak-package");

if (
  requestedStagingDir !== artifactsRoot &&
  !requestedStagingDir.startsWith(`${artifactsRoot}${path.sep}`)
) {
  throw new Error("The mpak staging directory must stay within artifacts/.");
}

if (!existsSync(requestedStagingDir)) {
  throw new Error(
    `Missing mpak staging directory: ${requestedStagingDir}. Run npm run prepare:mpak first.`,
  );
}

const sbomPath = path.join(requestedStagingDir, "sbom.cdx.json");
const manifest = JSON.parse(
  readFileSync(path.join(requestedStagingDir, "manifest.json"), "utf8"),
);

if (
  typeof manifest.name !== "string" ||
  manifest.name.length === 0 ||
  typeof manifest.version !== "string" ||
  manifest.version.length === 0
) {
  throw new Error("The staged manifest must declare a package name and version.");
}

rmSync(sbomPath, { force: true });

const syft = process.env.SYFT_BIN || "syft";
const result = spawnSync(
  syft,
  [
    `dir:${requestedStagingDir}`,
    "--source-name",
    manifest.name,
    "--source-version",
    manifest.version,
    "--output",
    `cyclonedx-json=${sbomPath}`,
  ],
  {
    cwd: repoRoot,
    encoding: "utf8",
  },
);

if (result.error) {
  throw new Error(`Unable to run Syft: ${result.error.message}`);
}

if (result.status !== 0) {
  throw new Error(
    `Syft failed to generate the mpak SBOM.\n${result.stderr || result.stdout}`,
  );
}

const sbom = JSON.parse(readFileSync(sbomPath, "utf8"));
if (sbom.bomFormat !== "CycloneDX" || !Array.isArray(sbom.components)) {
  throw new Error("Syft produced an invalid CycloneDX SBOM.");
}

if (!["1.4", "1.5", "1.6"].includes(sbom.specVersion)) {
  throw new Error(
    `Syft produced CycloneDX ${sbom.specVersion}; mpak MTF 0.1 supports versions 1.4 through 1.6.`,
  );
}

const npmPurlName = manifest.name.startsWith("@")
  ? `%40${manifest.name.slice(1)}`
  : manifest.name;
const packagePurl = `pkg:npm/${npmPurlName}@${manifest.version}`;
const stagingPackageName = "@ipgeolocation/ipgeolocation-io-mcp-mpak-staging";

sbom.components = sbom.components
  .filter((component) => component.type !== "file")
  .map((component) => {
    if (component.name !== stagingPackageName) {
      return component;
    }

    return {
      ...component,
      "bom-ref": packagePurl,
      name: manifest.name,
      version: manifest.version,
      purl: packagePurl,
      cpe: undefined,
      properties: component.properties?.filter(
        (property) => property.name !== "syft:cpe23",
      ),
    };
  });

if (sbom.components.length === 0) {
  throw new Error("Syft produced an empty SBOM for the mpak package.");
}

const componentWithoutPurl = sbom.components.find(
  (component) => typeof component.purl !== "string" || component.purl.length === 0,
);
if (componentWithoutPurl) {
  throw new Error(
    `SBOM component is missing a package URL: ${componentWithoutPurl.name ?? "unknown"}.`,
  );
}

sbom.metadata ??= {};
sbom.metadata.component = {
  "bom-ref": packagePurl,
  type: "application",
  name: manifest.name,
  version: manifest.version,
  purl: packagePurl,
};

const serializedSbom = `${JSON.stringify(sbom, null, 2)}\n`;
if (
  serializedSbom.includes(repoRoot) ||
  serializedSbom.includes(requestedStagingDir)
) {
  throw new Error("The generated SBOM contains an absolute workspace path.");
}

writeFileSync(sbomPath, serializedSbom);

console.log(
  `Generated CycloneDX ${sbom.specVersion} ${path.relative(repoRoot, sbomPath)} with ${sbom.components.length} components.`,
);
