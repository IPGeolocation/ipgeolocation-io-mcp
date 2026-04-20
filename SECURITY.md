# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | Yes       |
| < 1.0   | No        |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public GitHub issue.
2. Email **support@ipgeolocation.io** with a description of the vulnerability, steps to reproduce, and any relevant logs or screenshots.
3. You will receive an acknowledgment within 48 hours.
4. We aim to release a fix within 7 days of confirmation.

## Security Design

### API Key Handling

- The API key is read from the `IPGEOLOCATION_API_KEY` environment variable or injected per-session via the MCP runtime config.
- The key is never logged, cached to disk, or included in error messages.
- The key is transmitted only to `https://api.ipgeolocation.io` over HTTPS.

### Network Access

- All outbound requests target a single origin: `https://api.ipgeolocation.io`.
- Requests use a configurable timeout (default 15 seconds) to prevent hanging connections.
- No inbound network listeners are created. The server communicates exclusively via stdio.

### Permissions

- **Filesystem:** none
- **Network:** outbound only (HTTPS to `api.ipgeolocation.io`)
- **Subprocess:** none
- **Native modules:** none

These permissions are declared in `manifest.json` under the `_meta.org.mpaktrust` field.

### Environment Variables

| Variable | Purpose | Sensitive |
|----------|---------|-----------|
| `IPGEOLOCATION_API_KEY` | API authentication | Yes |
| `IPGEOLOCATION_REQUEST_TIMEOUT_MS` | Request timeout (1,000-120,000 ms) | No |
| `IPGEOLOCATION_MCP_CACHE_TTL_MS` | Cache TTL (1,000-3,600,000 ms) | No |
| `IPGEOLOCATION_MCP_CACHE_MAX_ENTRIES` | Max cache entries (10-5,000) | No |
| `IPGEOLOCATION_MCP_MAX_BULK_ITEMS` | Max bulk items per request (1-50,000) | No |
| `IPGEOLOCATION_MCP_MAX_RESULT_ITEMS` | Max items in response (1-50,000) | No |
| `IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS` | Max response size (10,000-2,000,000) | No |
| `IPGEOLOCATION_MCP_MAX_ERROR_CHARS` | Max error message size (200-50,000) | No |

All numeric environment variables use bounded parsing with safe defaults. Out-of-range values silently fall back to defaults.

### Dependencies

This package has two runtime dependencies:

- `@modelcontextprotocol/sdk` — MCP server framework
- `zod` — input schema validation

Transitive dependency versions are pinned via `overrides` in `package.json` to address known vulnerabilities in upstream packages.
