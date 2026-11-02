# mpak Packaging

mpak publishes this server as `@ipgeolocation/ipgeolocation-io-mcp`. The prep script derives that bundle from the root metadata and stages it in `artifacts/mpak-package/`. The npm package name, root manifests, and existing client install commands stay unchanged.

Version **2.0.2**. See the [release checklist](../../RELEASING.md) for publication channels, dated listing checks, and follow-ups.

## Prepare and Publish

1. Build the intended source with `npm run build`. Use `npm run prepare:mpak` and `npm run sbom:mpak` to inspect a local staging package and its CycloneDX SBOM. These commands write build artifacts; they do not publish a version.
2. Complete source and consumer verification, then create the matching Git tag and GitHub release as part of an authorized release.
3. For a new authorized release, dispatch **mpak Release** from its tag with `operation: publish`. Set both `source_ref` and `release_tag` to that tag. The workflow checks all five target filenames before building or signing and stops if any already exists.
4. Confirm that the release contains the `.mcpb`, `.mcpb.sigstore.json`, `.mcpb.provenance.sigstore.json`, `sbom.cdx.json`, and `server.json` assets. The workflow retains the exact signed files before uploading the signature, provenance and metadata, then uploads the bundle last. The separate announcement job verifies all five published files before announcing the bundle.
5. If an upload stops partway through, dispatch the same tagged workflow with `operation: resume` and the original `recovery_run_id`. It verifies that run's repository, tag and commit, checks its retained signature and provenance, and compares every existing release asset before uploading missing files. If only announcement needs retrying, dispatch with `operation: announce`. This works without rerunning the original job and does not rebuild, sign or upload files. Keep both tag inputs unchanged. These modes apply to releases created with this workflow. Older tags retain their original workflow. Signed files are retained for up to 90 days, subject to repository limits. If they have expired or are missing, stop for manual release review. Do not regenerate or replace existing signed assets.
6. Verify the public package version and bundle using the commands below. Review scan results for the same version.

The existing workflows have separate roles:

| Workflow | Trigger and purpose |
|----------|---------------------|
| `mpak-validate.yml` | Pull requests, pushes to `main`, and manual runs: build and validate a bundle. |
| `mpak-scan.yml` | Pull requests, pushes to `main`, and manual runs: build and scan a bundle. |
| `mpak-release.yml` | Manual only: publish assets and announce the bundle. Package, manifest, registry metadata, source tag, and release tag must agree. |

On Windows, prepare the bundle with `npm run prepare:mpak`; this provides the npm JavaScript CLI path without invoking a command shell. Custom staging directories must be children of `artifacts/` and cannot contain the selected source directory or escape through symlinks.

Local staging and scan builds do not acquire release signatures or provenance automatically. The release workflow signs and verifies its own output before uploading it.

## Verify a Published Bundle

Use GitHub CLI and Cosign in an empty download directory. Run the following as a Bash script so a failed download or verification stops the procedure. This example verifies `v2.0.2`; use the matching tag for other published releases.

```bash
set -euo pipefail
release_tag=v2.0.2
bundle_name="ipgeolocation-ipgeolocation-io-mcp-${release_tag#v}.mcpb"
workflow_identity="https://github.com/IPGeolocation/ipgeolocation-io-mcp/.github/workflows/mpak-release.yml@refs/tags/$release_tag"
release_commit=$(gh api "repos/IPGeolocation/ipgeolocation-io-mcp/commits/$release_tag" --jq .sha)

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
