# Release Checklist

Publish each version from one release commit. Keep package versions, release tags, signed bundles and registry records aligned. Verify the public artifacts after each publishing step.

## Release Channels

| Channel | Publication and verification |
| --- | --- |
| [npm](https://www.npmjs.com/package/ipgeolocation-io-mcp) | Publish the package once, verify its latest tag and test a fresh installation. |
| [GitHub Releases](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases) | Publish the matching version tag and MCP Bundle. Upload the bundle signature and provenance. Include its SBOM and registry metadata, then verify the artifacts. |
| [Official MCP Registry](https://registry.modelcontextprotocol.io/?q=ipgeolocation) | Run the existing registry workflow after npm publishes the matching version. Verify the active record, exact package version, stdio transport and secret API-key configuration. |
| [mpak](https://registry.mpak.dev/packages/@ipgeolocation/ipgeolocation-io-mcp) | Run the existing mpak workflow from the release tag. Verify the version, security scan and bundle signature. |
| [Smithery](https://smithery.ai/servers/ipgeolocation/ipgeolocation-io-mcp) | Publish the verified local bundle through the existing server account. Check the release version, tool catalog and configuration. |
| [Glama](https://glama.ai/mcp/servers/IPGeolocation/ipgeolocation-io-mcp) | Verify the hosted release, public schema, server instructions and copied README separately. Listing text can lag the runtime. |
| [Claude Marketplace](https://claude.com/marketplace/connectors/ipgeolocation-io-mcp-server) | Use the existing approved listing and GitHub Release bundle flow. Check the directory-installed version and tool discovery after the provider refreshes it. |

Keep published npm versions and signed GitHub assets intact. Directory copy changes do not require republishing a package or replacing release assets.

## Listings and Client Packaging

Keep descriptions, tool counts, Node.js requirements, plan qualifications, API-key setup and cached-pagination guidance aligned with the current server. Include company information separately from ASN and network data when describing its capabilities.

Public npm commands and launcher configurations use `ipgeolocation-io-mcp@latest`. Exact versions remain in package manifests, registry records, release tags and signed bundle links. Source and Docker installations run the server built from their selected revision.

- Edit metadata through existing owner controls on claimed directories. For repository-backed catalogs, submit the smallest metadata correction through their contribution process.
- Verify copied README text and generated client configurations after the source changes. A current version label does not establish that the install examples refreshed.
- Keep pending provider reviews separate from publication. Verify the public entry after acceptance. Avoid duplicate submissions.
- Validate client-specific packaging before submitting to Cursor Marketplace or Kiro Powers. Gemini CLI extensions need a public root manifest and the `gemini-cli-extension` topic for gallery discovery. Keep that packaging in its existing companion repository.
- Goose [retired its separate third-party MCP directory](https://github.com/aaif-goose/goose/issues/12916#issuecomment-6217396793) and directs publishers to the Official MCP Registry. Verify that registry record instead of opening a legacy-directory implementation PR.

## Release Order

1. Keep the next version marked unreleased until publication is authorized. Confirm that `package.json`, `package-lock.json`, `manifest.json`, and both version fields in `server.json` agree.
2. Run `npm test` and `npm audit`. Inspect `npm pack --dry-run`, then test the packed package in a fresh consumer installation. Build and test the Docker image and scan its runtime and operating-system packages. `npm audit` does not cover the whole image. Record any unfixed upstream advisories. Run credit-consuming live tests separately with private environment variables, including complete cached-pagination recovery.
3. Prepare the release commit, change the unreleased labels to the release date, and create the matching `v<version>` tag and GitHub release. Build and publish from that tagged source. Before publication, rebuild assets after documentation or metadata edits. Do not reuse earlier QA bundles.
4. Publish npm and verify its version, package contents, Node.js requirement, and fresh-consumer dependency audit. The Official MCP Registry workflow checks that the npm version already exists.
5. Run **mpak Release** from the same Git tag, with `source_ref` and `release_tag` both set to that tag. Follow the [bundle procedure](packaging/mpak/README.md) to verify the bundle signature and provenance. Check its SBOM against the packaged dependencies.
6. Run **MCP Registry Publish** with the matching `release_tag`. Re-read the public registry API and mpak package page. Confirm that their public metadata matches the released version.
7. Verify that Claude Marketplace / Anthropic MCP Directory has picked up the new GitHub Release bundle. Check the directory-installed version and tool discovery. Follow up if the listing or installed bundle remains on the previous version.
8. Update the integration page and verify the listings above. Check copied README text, install commands, plan qualifications, tool counts, input limits, output schemas, and cached-page guidance against the released version.

## Client and Security Checks

Cursor's install link and the Claude Desktop, Cline, Windsurf, VS Code, and Codex configurations consume the npm package or MCP Bundle. Check them against the released artifact and preserve existing client settings. Record which GUI and operating-system installations were actually tested.

Check the commit, date and artifact version in the [OpenSSF Scorecard report](https://api.scorecard.dev/projects/github.com/IPGeolocation/ipgeolocation-io-mcp) and [SafeSkill scan](https://safeskill.dev/scan/ipgeolocation-io-mcp) before making certification claims about a release.

Keep API keys in private client configuration or environment settings. Remove credentials and private lookup data from public logs and release artifacts, including screenshots or submissions.
