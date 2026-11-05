# Security Policy

## Supported Versions

| Version | Security updates |
|---------|------------------|
| 2.x | Fixes ship in new 2.x releases. Upgrade to the latest published patch. |
| < 2.0 | Unsupported. |

This policy describes the current source, including unreleased changes. For an installed version, use the policy from its matching [release tag](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases). See the [changelog](CHANGELOG.md) for version-specific fixes.

Keep your Node.js runtime on a supported release with current security updates. The minimum Node.js version describes compatibility. It does not make older patch releases safe to use.

The [October 21, 2026 Node.js security release](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
requires Node.js 22.23.4+, 24.22.1+ or 26.12.1+ on those respective release lines.
Update the runtime used by npm installations and restart the server process.
The Dockerfile pins Node.js 24.22.1 by image digest; rebuild existing images to
receive the runtime update.

## Reporting a Vulnerability

Use [GitHub private vulnerability reporting](https://github.com/IPGeolocation/ipgeolocation-io-mcp/security/advisories/new), or email **support@ipgeolocation.io** if private reporting is unavailable. Keep vulnerability details out of public issues.

Include the affected version and installation method. Describe the steps that cause the issue and its impact. Attach logs or screenshots after removing credentials and private lookup data.

We review reports and coordinate fixes and disclosure with the reporter. Response and fix timing depend on severity and whether we can reproduce the issue.

<a id="security-design"></a>

## API Key Handling

- Supply the key through `IPGEOLOCATION_API_KEY` or the configuration passed by your host. The server keeps it in memory and does not write it to disk.
- Authenticated requests send the key to `https://api.ipgeolocation.io` over HTTPS in the `x-ipgeolocation-api-key` header. The server blocks redirects before forwarding credentials or request data.
- The server masks credential fields and configured API-key matches in returned data. It preserves ordinary names and user-agent strings. Short keys use whole-token matching to avoid hiding unrelated text. See the [credential masking reference](REFERENCE.md#credential-masking) for the supported forms and limits.
- Your client or hosting provider may store configuration and logs separately. Keep keys out of shared files and public issues. Remove them before sharing screenshots or copying terminal commands.

## Lookup Data and Caching

API lookups send their inputs to IPGeolocation.io. The provider also receives the public IP of the machine running the server, including when you use `get_my_ip`. See the [privacy policy](https://ipgeolocation.io/privacy.html).

Cached responses and saved result pages stay in process memory. Cached data is separated by API key. Sessions sharing a key also share its cached data. This does not provide separate user access controls.

Normal responses expire five minutes after storage by default. Saved results also expire after five minutes without a successful page read; each successful read restarts their timer. Restarting the server or making room for newer results can also remove cached data. Expired data can remain in memory until a later cache operation removes it. Expiry does not securely erase memory.

Page cursors use random identifiers and require the same API key and server process. The server masks credentials before splitting a result into pages. Reading a page never calls the API, even if the cursor is invalid or expired. See [cached results](README.md#cached-result-pagination).

Cache, input and response limits reduce memory use, but they do not cap the process's total memory. Large responses and concurrent calls need extra memory. See [resource limits](CONTRIBUTING.md#resource-limits).

## Tool Inputs and Returned Text

The server rejects unknown arguments, wrong types, missing required fields, oversized batches and invalid dates or coordinate pairs before an API call. It also limits incoming message sizes. The API checks lookup targets and plan access. A valid call can use credits even though it only reads data.

Returned WHOIS records, hostnames, user agents, contact text and errors can contain untrusted content. Clients must keep this data from changing their instructions or authorizing other actions. IP security indicators need interpretation. They do not prove that traffic is safe or malicious.

## Network Access

- Lookup requests use HTTPS to `api.ipgeolocation.io`. The server communicates with its client over stdio and does not open an incoming network port.
- Requests have a time limit. The server checks response formats and limits their size and nesting depth. A timeout or rejected response can occur after the API processed the request, so retrying may use credits again. See the [technical reference](REFERENCE.md) for exact limits and error fields.

## Permissions

- Tools do not read or write local files, start subprocesses or load third-party native modules.
- The permissions listed in `manifest.json` describe runtime behavior. They do not enforce an operating-system sandbox. Node.js still reads application and dependency files. Installation, building, inspectors, clients and hosting providers have their own access.

## Environment Variables

`IPGEOLOCATION_API_KEY` is a secret. The other [runtime settings](REFERENCE.md#environment-variables) control timeouts, caching and response limits and do not contain credentials.

## Dependencies

The server uses the MCP SDK and Zod. The repository pins dependency versions with a lockfile and overrides, but npm does not apply this package's overrides inside another project. Check the dependencies actually installed in your environment. Maintainers should follow the [release checklist](RELEASING.md).

## Release Integrity

Published MCP bundles include a dependency list (SBOM), a Sigstore signature and GitHub build provenance. The release workflow verifies these before upload and refuses to replace existing assets. Local builds do not receive release signatures automatically.

Follow the [bundle verification commands](packaging/mpak/README.md#verify-a-published-bundle). A valid signature identifies the producing workflow. Review the source and dependency checks for that version, along with its security results.
