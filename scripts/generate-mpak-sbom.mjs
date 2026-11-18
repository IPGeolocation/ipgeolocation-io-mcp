import {
  existsSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const artifactsRoot = path.join(repoRoot, "artifacts");
const requestedStagingDir = process.argv[2]
  ? path.resolve(repoRoot, process.argv[2])
  : path.join(artifactsRoot, "mpak-package");

function isChild(parent, target) {
  const relative = path.relative(parent, target);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function containsWorkspacePath(sbom) {
  const normalize = value => {
    const normalized = value.replaceAll("\\", "/");
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  };
  const roots = [repoRoot, requestedStagingDir, realpathSync(repoRoot), realpathSync(requestedStagingDir)]
    .flatMap(root => [normalize(root), path.posix.normalize(normalize(root))]);
  const pending = [sbom];
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === "string") {
      const candidates = [value];
      try { candidates.push(decodeURIComponent(value)); } catch {}
      for (const candidate of candidates) {
        const normalized = normalize(candidate);
        if (roots.some(root => normalized.includes(root) || path.posix.normalize(normalized).includes(root))) return true;
      }
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) pending.push(key, child);
    }
  }
  return false;
}

if (!isChild(artifactsRoot, requestedStagingDir)) {
  throw new Error("The mpak staging directory must be a child of artifacts/.");
}

if (!existsSync(requestedStagingDir)) {
  throw new Error(
    `Missing mpak staging directory: ${requestedStagingDir}. Run npm run prepare:mpak first.`,
  );
}

if (!isChild(path.join(realpathSync(repoRoot), "artifacts"), realpathSync(requestedStagingDir))) {
  throw new Error("The mpak staging directory must stay within artifacts/ without escaping through a symlink.");
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

const rawSbomPath = path.join(requestedStagingDir, `.sbom-${randomUUID()}.json`);
try {
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
      `cyclonedx-json=${rawSbomPath}`,
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

  const sbom = JSON.parse(readFileSync(rawSbomPath, "utf8"));
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

  if (containsWorkspacePath(sbom)) {
    throw new Error("The generated SBOM contains an absolute workspace path.");
  }

  writeFileSync(sbomPath, `${JSON.stringify(sbom, null, 2)}\n`);

  console.log(
    `Generated CycloneDX ${sbom.specVersion} ${path.relative(repoRoot, sbomPath)} with ${sbom.components.length} components.`,
  );
} catch (error) {
  rmSync(sbomPath, { force: true });
  throw error;
} finally {
  rmSync(rawSbomPath, { force: true });
}
