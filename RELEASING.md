# Release Checklist

This checklist covers **2.0.1**. The platform tables record public checks made on **2026-10-11 before publication** and the follow-ups for this release. Recheck their status after publishing.

## Release Channels

| Platform | Public state before 2.0.1 | Action for 2.0.1 |
|----------|----------------------|------------------|
| [npm](https://www.npmjs.com/package/ipgeolocation-io-mcp) | `latest` is `2.0.0`, confirmed through the [registry API](https://registry.npmjs.org/ipgeolocation-io-mcp/latest). | Publish the package from the release commit, then verify a fresh installation. |
| [GitHub Releases](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases) | Latest release is `v2.0.0`, with an MCP Bundle, SBOM, signature, provenance, and registry metadata. | Create the version tag and release; upload and verify the matching bundle assets. |
| [Claude Marketplace / Anthropic MCP Directory](https://claude.com/marketplace/connectors/ipgeolocation-io-mcp-server) | Public listing is live and marked Anthropic verified; it lists 16 tools and a 1,000-item batch default. Approval confirmation records `v2.0.0`. | Publish the matching versioned `.mcpb` through the existing GitHub Releases flow, then verify the directory picks up `2.0.1`, its 17 tools, limits, and pagination guidance. |
| [Official MCP Registry](https://registry.modelcontextprotocol.io/?q=ipgeolocation) | The [server record](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.IPGeolocation%2Fipgeolocation-io-mcp/versions/latest) is active at `2.0.0`. | Run the existing manual registry workflow after npm publishes the matching version. |
| [mpak](https://registry.mpak.dev/packages/@ipgeolocation/ipgeolocation-io-mcp) | Package and bundle are `2.0.0`; the displayed security scan is dated 2026-07-26. | Run the existing manual mpak release workflow from the release tag, then verify the new version and scan results. |

Anthropic's approval confirmation dated 2026-08-16 states that future versions published through the same GitHub Releases process are picked up by the directory. This is a downstream distribution channel for the existing bundle. Keep the publishing workflow and asset format intact, and verify the installed version after each release.

## Listings and Documentation

| Platform | Current public check | Follow-up |
|----------|----------------------|-----------|
| [Glama](https://glama.ai/mcp/servers/IPGeolocation/ipgeolocation-io-mcp) | Listing is accessible and displays the `2.0.0` README and 16 tools. | Verify refreshed source, descriptions, tool discovery, and optional configuration after publication. |
| [Docker MCP Catalog submission](https://github.com/docker/mcp-registry/pull/1624) | Pull request is open and has no merge conflicts, but its source pin contains `1.0.9`. No current CI results were available. | Update the source pin to the intended published release and validate against current catalog requirements. Private test-credential receipt and validity remain unverified. Docker builds the catalog image after acceptance. |
| [Obot MCP Images submission](https://github.com/obot-platform/mcp-images/pull/447) | Pull request is open, has merge conflicts, and packages `1.0.13`. | Resolve conflicts, update to the intended published version, and validate the image. Complete the matching catalog submission after the image is available. |
| [Cline Marketplace submission](https://github.com/cline/mcp-marketplace/issues/865) | Submission is open with no reviewer reply. Its PNG is 310 by 310 pixels; current requirements call for 400 by 400. The checked installation-test claim still needs verification. | Supply a 400 by 400 PNG and verify or correct the Cline installation claim, then await review. Manual Cline configuration remains available. |
| [PulseMCP](https://www.pulsemcp.com/servers/ipgeolocation-io) | Public listing is accessible; its version was not confirmed. | Recheck the linked `server.json` and registry refresh after publication. |
| [mcp.so submission](https://github.com/chatmcp/mcpso/issues/781) | Submission is open with no replies. It includes the information required by the current public submission guidance. A live server page was not confirmed. | Await review and confirm the listing URL before treating it as an available install channel. |
| [awesome-mcp-servers, active submission](https://github.com/punkpeye/awesome-mcp-servers/pull/14808) | Submission check passed. The maintainer requested a Glama ownership claim on 2026-10-09. The PR also has merge conflicts. | Claim the server on Glama, resolve the conflicts, and await merge. |
| [awesome-mcp-servers, archived repository](https://github.com/appcypher/awesome-mcp-servers) | Repository is archived. The previously recorded submission `#561` is unavailable. | Retire this pending record and track the separate active submission above. |
| [Playbooks](https://playbooks.com/) | The homepage now shows a different product's Coming soon page. Earlier support outreach has no verified acknowledgement or listing. | Confirm the destination and outreach receipt before treating it as a pending directory review. |
| [MCPServerSpot](https://www.mcpserverspot.com/servers/ipgeolocationio-mcp-server) | Listing is live with the repository, npm setup, signup link, and 16 tools. | Refresh changed descriptions after publication; no listing-approval wait remains. |
| [Smithery](https://smithery.ai/servers/@IPGeolocation/ipgeolocation-io-mcp) | A project page exists. Published version, hosted runtime, and deployment access were not verified. | Keep hosted deployment deferred until its requirements and maintenance are agreed. Recheck the existing page after release. |
| [IPGeolocation.io integration page](https://ipgeolocation.io/integrations/ipgeolocation-io-mcp) | Page describes `2.0.0`, 16 tools, and a 1,000-item batch default. | Coordinate the website update with the release: 17 tools, 250 effective inputs by default, pagination, setup, errors, and cache behavior. |

Public searches also found downstream directory records. These need a refresh check after the primary channels publish; their presence does not establish a separate deployment.

| Directory | Check on 2026-10-11 |
|-----------|---------------------|
| [MCP Marketplace](https://www.mcp-marketplace.io/server/io-github-ipgeolocation-ipgeolocation-io-mcp) | Page accessible; displays `2.0.0` content. |
| [mcpserver.lol](https://mcpserver.lol/servers/ipgeolocation-io-mcp.html) | Page accessible; displays 16 tools. Version not confirmed. |
| [MCPHQ](https://mcphq.ai/mcp/ipgeolocation-ipgeolocation-io-mcp) | Page accessible; displays `v2.0.0`. |
| [MCPNav](https://mcpnav.net/server/ipgeolocation-io-mcp/) | Search record found; direct fetch timed out. |
| [mcpbeat](https://mcpbeat.com/mcp-servers/ipgeolocation/ipgeolocation-io-mcp/) | Search record found; direct fetch returned HTTP 403. |
| [MCP.Directory](https://mcp.directory/clients/vscode) | Search record references this server; a dedicated project URL was not confirmed. |

## Release Order

1. Keep the next version marked unreleased until publication is authorized. Confirm that `package.json`, `package-lock.json`, `manifest.json`, and both version fields in `server.json` agree.
2. Run `npm test` and `npm audit`. Inspect `npm pack --dry-run`, then test the packed package in a fresh consumer installation. Build and test the Docker image and scan its runtime and operating-system packages; npm audit does not cover the whole image. Record any unfixed upstream advisories. Run credit-consuming live tests separately with private environment variables, including complete cached-pagination recovery.
3. Prepare the release commit, change the unreleased labels to the release date, and create the matching `v<version>` tag and GitHub release. Build and publish from that tagged source. Rebuild assets after documentation or metadata edits; do not reuse earlier QA bundles.
4. Publish npm and verify its version, package contents, Node.js requirement, and fresh-consumer dependency audit. The Official MCP Registry workflow checks that the npm version already exists.
5. Run **mpak Release** from the same Git tag, with `source_ref` and `release_tag` both set to that tag. Follow the [bundle procedure](packaging/mpak/README.md) to verify its signature, provenance, and SBOM.
6. Run **MCP Registry Publish** with the matching `release_tag`. Re-read the public registry API and mpak package page; a successful workflow is only one part of publication verification.
7. Verify that Claude Marketplace / Anthropic MCP Directory has picked up the new GitHub Release bundle. Check the directory-installed version and tool discovery; follow up if the listing or installed bundle remains on the previous version.
8. Update the integration page and verify the listings above. Check copied README text, install commands, plan qualifications, tool counts, input limits, output schemas, and cached-page guidance against the released version.

## Client and Security Checks

Cursor's install link and the Claude Desktop, Cline, Windsurf, VS Code, and Codex configurations consume the npm package or MCP Bundle. Check them against the released artifact and preserve existing client settings. Record which GUI and operating-system installations were actually tested.

The [OpenSSF Scorecard API](https://api.scorecard.dev/projects/github.com/IPGeolocation/ipgeolocation-io-mcp) returned a report dated 2026-10-10. The [SafeSkill scan URL](https://safeskill.dev/scan/ipgeolocation-io-mcp) returned a generic page without a confirmed project report. Recheck scan commit, date, and artifact version after release before making certification claims about 2.0.1.

Keep API keys in private client configuration or environment settings. Remove credentials and private lookup data from public logs, screenshots, submissions, and release artifacts.
