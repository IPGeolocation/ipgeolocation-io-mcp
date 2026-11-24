# MCP Bundle Packaging

GitHub Releases hosts the signed `@ipgeolocation/ipgeolocation-io-mcp` MCP Bundle. The prep script reads the root metadata and stages the files in `artifacts/mpak-package/`.

Version **2.0.3**. See the [release checklist](../../RELEASING.md) for publication channels, dated listing checks, and follow-ups.

## Prepare and Publish

Install Node.js 22 or later and npm, then run `npm ci --ignore-scripts` in the selected source directory. `npm run sbom:mpak` also needs Syft: put `syft` on `PATH`, or set `SYFT_BIN` to its executable. Bundle finalization needs `unzip`.

1. Run `npm run prepare:mpak` to build the source in `MPAK_SOURCE_DIR` (the repository root by default) and prepare a local staging package, then `npm run sbom:mpak` to generate its CycloneDX SBOM. These commands write build artifacts; they do not publish a version.
2. Complete source and consumer verification, then create the matching Git tag and GitHub release as part of an authorized release.
3. For a new authorized release, run **MCP Bundle Release** from a tag that contains this workflow. Choose `publish` and set both `source_ref` and `release_tag` to that tag. The workflow checks all five target filenames before building or signing and stops if any already exists.
4. Confirm that the GitHub release contains the `.mcpb`, `.mcpb.sigstore.json`, `.mcpb.provenance.sigstore.json`, `sbom.cdx.json`, and `server.json` assets. The workflow saves the signed files for recovery and uploads the bundle last. A read-only job verifies all five files after upload.
5. If an upload stops partway through, run the workflow from the same tag with `operation: resume` and the original `recovery_run_id`. It verifies the saved files and compares any files already on GitHub before uploading only missing assets. If verification alone failed, run `operation: verify` from the same tag to check the files already on GitHub.
6. Verify the bundle using the commands below and review the scan results for that version.

For tags created before this workflow update, including `v2.0.3`, use the verification commands below and handle recovery manually. GitHub retains signed recovery files for up to 90 days, subject to repository limits. If the files are missing or expired, stop for manual release review.

The existing workflows have separate roles:

| Workflow | Trigger and purpose |
|----------|---------------------|
| `mpak-validate.yml` | Pull requests, pushes to `main`, and manual runs: build and validate a bundle. |
| `mpak-scan.yml` | Pull requests, pushes to `main`, and manual runs: build and scan a bundle. |
| `mpak-release.yml` | Manual runs: publish, resume or verify signed GitHub release assets. Package, manifest, registry metadata, source tag and release tag must agree. |

On Windows, prepare the bundle with `npm run prepare:mpak`; this provides the npm JavaScript CLI path without invoking a command shell. Custom staging directories must be children of `artifacts/` and cannot contain the selected source directory or escape through symlinks.

Local staging and scan builds do not acquire release signatures or provenance automatically. The release workflow signs and verifies its own output before uploading it.

## Verify a Published Bundle

Use GitHub CLI and Cosign in an empty download directory. Run the following as a Bash script so a failed download or verification stops the procedure. This example verifies `v2.0.3`; use the matching tag for other published releases.

```bash
set -euo pipefail
release_tag=v2.0.3
bundle_name="ipgeolocation-ipgeolocation-io-mcp-${release_tag#v}.mcpb"
workflow_identity="https://github.com/IPGeolocation/ipgeolocation-io-mcp/.github/workflows/mpak-release.yml@refs/tags/$release_tag"
release_commit=$(gh api "repos/IPGeolocation/ipgeolocation-io-mcp/commits/refs%2Ftags%2F$release_tag" --jq .sha)

gh release download "$release_tag" \
  --repo IPGeolocation/ipgeolocation-io-mcp \
  --pattern "$bundle_name" \
  --pattern "$bundle_name.sigstore.json" \
  --pattern "$bundle_name.provenance.sigstore.json" \
  --pattern sbom.cdx.json

cosign verify-blob \
  --bundle "$bundle_name.sigstore.json" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity "$workflow_identity" \
  "$bundle_name"

gh attestation verify "$bundle_name" \
  --repo IPGeolocation/ipgeolocation-io-mcp \
  --bundle "$bundle_name.provenance.sigstore.json" \
  --cert-identity "$workflow_identity" \
  --source-ref "refs/tags/$release_tag" \
  --source-digest "$release_commit"
```

Stop if either verification fails. The signature and provenance identify the producing workflow and source commit; inspect the bundled dependency list and security reports as part of the [security review](../../SECURITY.md#release-integrity).
