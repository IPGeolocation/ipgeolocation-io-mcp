# mpak Packaging

mpak publishes this server as `@ipgeolocation/ipgeolocation-io-mcp`. The prep script derives that bundle from the root metadata and stages it in `artifacts/mpak-package/`. The npm package name, root manifests, and existing client install commands stay unchanged.

Version **2.0.2**. See the [release checklist](../../RELEASING.md) for publication channels, dated listing checks, and follow-ups.

## Prepare and Publish

1. Build the intended source with `npm run build`. Use `npm run prepare:mpak` and `npm run sbom:mpak` to inspect a local staging package and its CycloneDX SBOM. These commands write build artifacts; they do not publish a version.
2. Complete source and consumer verification, then create the matching Git tag and GitHub release as part of an authorized release.
3. Dispatch **mpak Release** from that tag. Set both `source_ref` and `release_tag` to the same tag, such as `v2.0.2` for this version.
4. Confirm that the workflow uploaded the `.mcpb`, `.mcpb.sigstore.json`, `.mcpb.provenance.sigstore.json`, `sbom.cdx.json`, and `server.json` assets, then announced the bundle to mpak.
5. Verify the public package version and bundle using the commands below. Review scan results for the same version.

The existing workflows have separate roles:

| Workflow | Trigger and purpose |
|----------|---------------------|
| `mpak-validate.yml` | Pull requests, pushes to `main`, and manual runs: build and validate a bundle. |
| `mpak-scan.yml` | Pull requests, pushes to `main`, and manual runs: build and scan a bundle. |
| `mpak-release.yml` | Manual only: publish assets and announce the bundle. Package, manifest, registry metadata, source tag, and release tag must agree. |

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
