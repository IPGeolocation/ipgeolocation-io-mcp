# Changelog

Changes in development appear under Unreleased. Published release details are available on [GitHub Releases](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases).

## Unreleased

- Update Zod to 4.6.7 and the body-parser, fast-uri, ip-address and qs dependency resolutions for security fixes and compatible transitive requirements. Oversized bulk input now fails its collection limit before individual elements are inspected.
- Pin the Docker build and runtime stages to Node.js 24.22.1 on Alpine 3.24 by digest, replacing the Debian base with unresolved OS advisories. Keep the non-root user, entrypoint and configuration unchanged. Run the full regression suite inside the container base on amd64 and arm64, verify read-only stdio and live HTTPS behavior, and reject high/critical image findings, including those without a fix.

## [2.0.1](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases/tag/v2.0.1) - 2026-10-11

- Retrieve complete oversized results with the new zero-credit `get_cached_result` tool. Page reads support replay and sliding idle expiry; unavailable cursors fail locally without another API call.
- Reject batches above the effective input limit before spending credits. The default is 250 inputs, set by the lower of the bulk and result item limits.
- Keep request deadlines active through body reads and share identical in-flight cached requests within the same API key.
- Fix cache-key collisions, preserve array row positions and IP identifiers during field selection, and match API include rules when filtering cached results.
- Infer geo accuracy and DMA modules from nested location fields. ASN exclusions no longer fetch optional datasets.
- Preserve valid JSON while redacting credentials. Reject unknown tool arguments and block redirects before forwarding credentials or request bodies.
- Bound complete error responses by the serialized UTF-8 byte limit and reject malformed public-IP responses without echoing their contents.
- Return structured output and error details alongside existing text, identify failed bulk inputs, and report missing network data without inventing upstream statuses.
- Upgrade MCP SDK to 1.32.1 and proxy-addr to 2.0.8. Refresh Docker's Node 24 base, apply the available Perl security update, verify compiler installation, and remove unused package installers from the runtime image. Run as the unprivileged Node user and make source builds portable across npm shells.
- Clarify client setup, plan access, billing estimates, cache behavior, response limits, security boundaries, and release verification in public documentation.
- Include linked public documentation in npm packages and MCP Bundles so their local links resolve.

## [2.0.0](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases/tag/v2.0.0) - 2026-07-24

- **Breaking:** Require Node.js 22 or later.
- Send API keys through the `x-ipgeolocation-api-key` header.
- Include the accumulated reliability and security improvements from the 1.0 releases.

## [1.0.20](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases/tag/v1.0.20) - 2026-06-11

- Improve Glama hosting entrypoints and tool metadata.
- Update dependency overrides.

## [1.0.19](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases/tag/v1.0.19) - 2026-04-28

- Harden upstream API error handling and provide actionable client guidance.
- Redact API keys and bearer-style secrets from outputs.
- Scope cache entries by API key.
- Add security tests for secret leakage, encoded echoes, untrusted upstream text, and query injection.
- Fix the Docker runtime entrypoint.

## [1.0.18](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases/tag/v1.0.18) - 2026-04-27

- Upgrade Hono dependencies and add npm audit gates.
- Fix test portability and mpak scanner bundle handling.

## [1.0.17](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases/tag/v1.0.17) - 2026-04-15

- Rerun mpak certification after branch-protection and workflow hardening.

## [1.0.16](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases/tag/v1.0.16) - 2026-04-13

- Harden mpak certification, keyless signing, provenance attestation, package claims, and icon metadata.

## [1.0.15](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases/tag/v1.0.15) - 2026-04-13

- Harden mpak certification, keyless signing, provenance attestation, package claims, and icon metadata.

## [1.0.14](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases/tag/v1.0.14) - 2026-04-13

- Harden mpak packaging, scope runtime configuration, and add compliance and icon metadata.

## [1.0.13](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases/tag/v1.0.13) - 2026-03-26

- Fix the CLI entrypoint for Smithery deployments.

## [1.0.12](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases/tag/v1.0.12) - 2026-03-26

- Add Smithery compatibility.

## Earlier releases

- [1.0.11](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases/tag/v1.0.11) - 2026-03-18
- [1.0.10](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases/tag/v1.0.10) - 2026-03-16
- [1.0.9](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases/tag/v1.0.9) - 2026-03-12
- [1.0.8](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases/tag/v1.0.8) - 2026-03-12
- [1.0.7](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases/tag/v1.0.7) - 2026-03-11
- [1.0.6](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases/tag/v1.0.6) - 2026-03-11
- [1.0.5](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases/tag/v1.0.5) - 2026-03-11
- [1.0.4](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases/tag/v1.0.4) - 2026-03-10
- [1.0.3](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases/tag/v1.0.3) - 2026-03-07
- [1.0.2](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases/tag/v1.0.2) - 2026-03-05
- [1.0.1](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases/tag/v1.0.1) - 2026-03-05
