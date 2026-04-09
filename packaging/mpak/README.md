This directory contains mpak-specific publishing templates.

Why it exists:
- mpak requires a scoped bundle identity such as `@scope/name`
- this repository already publishes different metadata for npm and the MCP registry
- changing the existing root metadata in place would risk breaking current integrations

How it works:
- `config.json` defines the isolated mpak bundle identity
- the prep script derives mpak metadata from the current root manifest and registry metadata
- `scripts/prepare-mpak-package.mjs` generates an isolated staging package in `artifacts/mpak-package/`
- GitHub Actions publish from that staging package only when manually dispatched

This keeps the current npm package, root `manifest.json`, root `server.json`, and existing client install paths unchanged.

Operational model:
- `mpak-validate.yml` is manual only
- `mpak-release.yml` is manual only
- run the release workflow against an existing Git tag so release assets and registry announcement target the correct version
