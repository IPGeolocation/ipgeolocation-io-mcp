# Contributing

Use [GitHub Issues](https://github.com/IPGeolocation/ipgeolocation-io-mcp/issues) for bugs and feature requests. Report security vulnerabilities through the [private channel in SECURITY.md](SECURITY.md#reporting-a-vulnerability).

## Reporting a Bug

Tell us:

- MCP client name and version, operating system, and installation method: npm, source, Docker, MCP Bundle, or hosting provider
- Running server version shown in the client's MCP connection or initialization details; if unavailable, say so and provide the installed package or bundle version
- Node.js version (`node --version`), where applicable
- API plan: free, paid, or unknown; do not include the key
- Tool name, sanitized arguments, and steps to reproduce
- Expected and actual results, including the sanitized error text and structured error fields if available

`npm info ipgeolocation-io-mcp version` reports the latest registry version, which may differ from the process your client is running. For a source build, include the commit and whether it has local changes.

Remove credentials, authorization headers, and private lookup data from logs and screenshots. Avoid posting complete client configuration files. A small reproduction with public sample inputs is easier to investigate.

## Requesting a Feature

Open an issue describing the task you need to complete and your current workaround. Link the relevant IPGeolocation.io API endpoint if one exists.

## Contributing Code

1. Open an issue first to discuss the change.
2. Fork the repo and branch off `main`.
3. Make your changes.
4. Run `npm ci --ignore-scripts` and `npm test`. Add regression coverage for behavior changes. Live API checks are separate and consume credits; use private environment variables if they are needed.
5. Open a pull request that references the issue.

Follow the TypeScript patterns in `src/` and discuss new dependencies first. Keep unrelated edits and existing client configuration out of the change. For documentation edits, check examples, links, and version qualifications against the implementation.

See [RELEASING.md](RELEASING.md) for publication channels and release verification.

## Resource Limits

Tool arguments have a 4 MiB default limit, measured as UTF-8 bytes of `JSON.stringify(arguments)`. Stdio uses a separate wire-buffer cap of `6 × argument limit + 128 KiB` (24 MiB + 128 KiB by default) to accommodate six-byte JSON string escapes. Exceeding that cap closes the session and can discard pending replies after the API has used credits.

The default cache budget is 32 MiB across up to 500 entries. Accounting covers serialized API values, cache keys and refresh-family identifiers, plus retained pagination JSON and snapshot metadata. Snapshot JSON counts at its UTF-8 size without another escaping layer. Successful page reads extend snapshot expiry without serializing the full snapshot again.

Cached API data and its pagination snapshot both use this budget. If they do not fit together, storing the snapshot can evict the API response. Calling the lookup again may then spend credits; use `get_cached_result` to retrieve its remaining pages. Allow space for the response, snapshot, metadata and other cached results when lowering the cache budget.

The server limits successful API bodies to 8 MiB by default after decompression, error bodies to 64 KiB and upstream JSON to 64 nesting levels. These bounds do not limit total heap or resident memory.

Size a memory-limited runtime for the expected response shapes, cache settings and concurrent calls. The tested object-heavy workloads completed with a 512 MiB V8 heap, but this is not a guarantee for every response. The container also needs memory for Buffers and other allocations outside that heap. Test available memory before raising response or cache limits.

A local fields/excludes projection cannot reduce bytes already downloaded. ASN fields can enable optional upstream include datasets. Check request-specific error guidance before changing the request.

## License

By contributing, you agree that your work will be licensed under the [MIT License](LICENSE).
