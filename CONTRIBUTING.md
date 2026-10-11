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

## License

By contributing, you agree that your work will be licensed under the [MIT License](LICENSE).
