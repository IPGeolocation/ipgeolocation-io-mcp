# Security Policy

## Supported Versions

| Version | Security updates |
|---------|------------------|
| 2.x | Fixes ship in new 2.x releases; upgrade to the latest published patch. |
| < 2.0 | Unsupported. |

Version **2.0.2** includes the strict argument validation, redirect blocking, and cached pagination introduced in 2.0.1, with updated dependencies. The design below also covers unreleased resource limits and cache-refresh hardening in this checkout; use the matching release tag for published-version behavior. See the [changelog](CHANGELOG.md) and [published releases](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases) for version-specific changes.

Keep your Node.js runtime on a supported release with current security updates. The minimum Node.js version describes compatibility; it does not make older patch releases safe to use.

The [October 21, 2026 Node.js security release](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
requires Node.js 22.23.4+, 24.22.1+ or 26.12.1+ on those respective release lines.
Update the runtime used by npm installations and restart the server process.
The Dockerfile pins Node.js 24.22.1 by image digest; rebuild existing images to
receive the runtime update.

## Reporting a Vulnerability

Use [GitHub private vulnerability reporting](https://github.com/IPGeolocation/ipgeolocation-io-mcp/security/advisories/new), or email **support@ipgeolocation.io** if private reporting is unavailable. Keep vulnerability details out of public issues.

Include the affected version and installation method, reproduction steps, impact, and sanitized logs or screenshots. Remove API keys, authorization headers, and private lookup data before sending them.

We triage reports and coordinate fixes and disclosure with the reporter. Response and fix timing depend on severity, reproducibility, and the changes required.

## Security Design

### API Key Handling

- The server reads `IPGEOLOCATION_API_KEY` from its environment or accepts an API key through per-session runtime configuration.
- The server keeps the key in process memory and does not write it to disk. It masks explicit credential fields and configured-key matches while preserving ordinary names and user-agent strings. Error diagnostics also mask recognized credential patterns.
- Configured-key matching supports literal text, mixed JSON escapes, `encodeURI`/`encodeURIComponent` output, form encoding, fully percent-encoded text, and one additional `encodeURIComponent` layer over URI/form/percent forms. Matching preserves the key's letter case; it does not guess uppercasing or other transformations.
- Keys shorter than four Unicode characters use token boundaries in ordinary text. Unlabeled numbers are masked only when their complete string representation matches a key of at least four characters. Labeled credential fields are always masked in full.
- Authenticated API calls send the key to `https://api.ipgeolocation.io` over HTTPS in the `x-ipgeolocation-api-key` header, rather than a request URL. HTTP redirects are blocked before credentials or request bodies can be forwarded.
- Your MCP client or hosting provider may store configuration and logs separately. Protect those settings and keep credentials out of committed project files, public issues, screenshots, and command histories.

### Lookup Data and Caching

Tool calls send the requested IP addresses, domains, location selectors, dates, or user-agent strings to the IPGeolocation.io API as required by the endpoint. The provider also receives the request's public egress IP, including for the keyless `get_my_ip` tool. See the [IPGeolocation privacy policy](https://ipgeolocation.io/privacy.html) for provider handling.

Normal cached responses and complete pagination snapshots stay in process memory. Their namespaces use an API-key hash: different keys use separate namespaces, while sessions using the same key share one. This is API-key isolation, not separate authorization for users sharing a key.

Normal responses expire five minutes after storage by default. Successful cached-page reads extend that snapshot's idle expiry by five minutes. Expired entries are removed during later cache operations; expiry is not a secure memory-erasure guarantee. Eviction or process exit can also remove results.

The cache enforces entry and byte limits shared by responses and pagination snapshots. Input and response limits also reduce the risk of resource exhaustion. These limits do not cap total process memory; JSON parsing and concurrent requests require additional memory. See [resource limits](CONTRIBUTING.md#resource-limits) for the calculations.

Cached-result cursors contain random identifiers and use the same API-key namespace. Complete output is redacted before fragmentation. Page reads never call the API, including on invalid, expired, or unavailable cursors. See [pagination](README.md#cached-result-pagination) for retrieval and expiry behavior.

### Tool Inputs and Returned Text

Registered schemas reject unknown arguments, wrong field types, missing required fields, and oversized batches before an API call. The server also checks argument size and validates dates and coordinate pairs. It closes the connection if incoming stdio data exceeds the wire-buffer cap. The API validates other values, including lookup targets and plan access. Malformed MCP requests can instead fail at the protocol layer. Valid lookup calls can consume API credits even though the tools only read API data.

Treat returned WHOIS, hostnames, user agents, contact text, and error messages as untrusted data. These values must not override the client's instructions or authorize another action. IP security indicators provide evidence for a user's policy; they do not establish that traffic is harmless or malicious.

### Network Access

- The server's lookup requests target `https://api.ipgeolocation.io`. Redirect responses produce a non-retryable local `redirect_blocked` error.
- The configurable request deadline covers headers and body reading; its default is 15 seconds. A timeout can occur after a paid request was processed, so retrying can consume credits again.
- Successful upstream bodies are limited to 8 MiB by default after HTTP decompression. Bodies above the configured limit fail locally and can already have used credits. Error bodies have a fixed 64 KiB diagnostic limit; oversized diagnostics are omitted while the received HTTP status is preserved.
- Upstream JSON must have the expected object/bulk shape and nesting depth of at most 64 before recursive formatting, redaction, and caching. The depth guard applies to upstream JSON; tool arguments use their byte limit and registered schemas.
- The server communicates over stdio and creates no inbound network listener.

### Permissions

- **Filesystem:** no tool-data reads or writes
- **Network:** outbound only (HTTPS to `api.ipgeolocation.io`)
- **Environment:** read API key and runtime settings
- **Subprocess:** none
- **Native modules:** none

These declarations in `manifest.json` describe the server's runtime behavior; they do not enforce an operating-system sandbox. Node.js still loads application and dependency files. Installation, building, inspectors, MCP clients, and hosting providers have their own filesystem, network, and process behavior.

### Environment Variables

| Variable | Purpose | Sensitive |
|----------|---------|-----------|
| `IPGEOLOCATION_API_KEY` | API authentication | Yes |
| `IPGEOLOCATION_REQUEST_TIMEOUT_MS` | Request timeout (1,000-120,000 ms) | No |
| `IPGEOLOCATION_MCP_CACHE_TTL_MS` | Normal-response TTL and page idle TTL (1,000-3,600,000 ms) | No |
| `IPGEOLOCATION_MCP_CACHE_MAX_ENTRIES` | Cached response and snapshot entry limit (10-5,000), also subject to the cache byte budget | No |
| `IPGEOLOCATION_MCP_CACHE_MAX_BYTES` | Accounted cache-data budget: default 33,554,432 bytes (32 MiB), range 4,194,304-1,073,741,824 (4 MiB-1 GiB); not a process-memory limit | No |
| `IPGEOLOCATION_UPSTREAM_MAX_RESPONSE_BYTES` | Successful upstream body limit: default 8,388,608 bytes (8 MiB), range 1,048,576-268,435,456 (1-256 MiB) | No |
| `IPGEOLOCATION_MCP_MAX_ARGUMENT_BYTES` | Serialized argument limit: default 4,194,304 bytes (4 MiB), range 65,536-33,554,432 (64 KiB-32 MiB) | No |
| `IPGEOLOCATION_MCP_MAX_BULK_ITEMS` | Bulk input ceiling (1-50,000), also capped by `IPGEOLOCATION_MCP_MAX_RESULT_ITEMS` | No |
| `IPGEOLOCATION_MCP_MAX_RESULT_ITEMS` | Bulk input/result item ceiling (1-50,000); nested arrays remain complete through cached pagination | No |
| `IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS` | Complete tool-result budget in UTF-8 bytes (10,000-2,000,000), including text and structured content for successes and errors | No |
| `IPGEOLOCATION_MCP_MAX_ERROR_CHARS` | Upper limit on error-message characters (200-50,000) before truncation markers; the complete response byte budget can shorten messages further | No |

All numeric environment variables use bounded parsing with safe defaults. Out-of-range values silently fall back to defaults.

### Dependencies

This package has two runtime dependencies:

- `@modelcontextprotocol/sdk`: MCP server framework
- `zod`: input schema validation

The repository uses a lockfile and `overrides` for transitive dependencies. npm considers overrides only in the root project's `package.json`; this package's overrides do not control a consumer's dependency resolution. Audit both the source installation and a fresh consumer installation when releasing. See [npm's override rules](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#overrides).

### Release Integrity

Bundles published through the repository's **mpak Release** workflow include a CycloneDX SBOM, Sigstore keyless signature, and GitHub build-provenance attestation. The workflow verifies signature and provenance before uploading release assets, checks all target asset names before uploading, and refuses to replace existing assets. Locally built bundles do not receive those attestations automatically.

Follow the [bundle verification commands](packaging/mpak/README.md#verify-a-published-bundle) and [release checklist](RELEASING.md). A signature identifies the workflow that produced an artifact; review its source, dependency audits, and scan results for the matching version as well.
