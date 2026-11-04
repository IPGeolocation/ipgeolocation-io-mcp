# IPGeolocation.io MCP Server

[![SafeSkill](https://safeskill.dev/api/badge/ipgeolocation-io-mcp)](https://safeskill.dev/scan/ipgeolocation-io-mcp)

[![npm version](https://img.shields.io/npm/v/ipgeolocation-io-mcp?logo=npm&label=npm&color=CB3837)](https://www.npmjs.com/package/ipgeolocation-io-mcp)
[![GitHub release](https://img.shields.io/github/v/release/IPGeolocation/ipgeolocation-io-mcp?logo=github&label=release&color=181717)](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-live-0A7CFF?logo=modelcontextprotocol&logoColor=white)](https://registry.modelcontextprotocol.io/?q=ipgeolocation)
[![Glama](https://img.shields.io/badge/Glama-listed-0A7CFF)](https://glama.ai/mcp/servers/IPGeolocation/ipgeolocation-io-mcp)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/IPGeolocation/ipgeolocation-io-mcp/badge)](https://scorecard.dev/viewer/?uri=github.com/IPGeolocation/ipgeolocation-io-mcp)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-5FA04E?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-16A34A)](https://github.com/IPGeolocation/ipgeolocation-io-mcp/blob/main/LICENSE)

The official [IPGeolocation.io](https://ipgeolocation.io) MCP server provides 17 tools for accurate IP geolocation, company information, ASN and network data, IP security (VPN, proxy, Tor, bot, hosting and spam detection), abuse contacts, time zones, astronomy, currency data and user-agent parsing.

MCP (Model Context Protocol) connects your client to these tools. Your client or host must support launching a local command over `stdio`. See [Install by Client](#install-by-client) for configuration examples.

**Published version: [2.0.2](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases/tag/v2.0.2).** This checkout also contains [unreleased changes](CHANGELOG.md#unreleased), which need a source build until the next release.

The install commands follow npm's `latest` tag, including future major releases. Restart the server to load an update. Source and Docker installations need a rebuild.

| Item | Value |
|------|-------|
| Package | `ipgeolocation-io-mcp` |
| Version | `2.0.3` |
| Release date | Unreleased |
| Transport | `stdio` |
| Node.js | `>=22` |

## Quick Start

1. [Create a free IPGeolocation.io API key](https://app.ipgeolocation.io/signup).
2. Merge this entry into your client's private configuration, keeping any existing servers. See [Install by Client](#install-by-client) for the configuration location. Cursor also has a [one-click installer](#cursor).

```json
{
  "mcpServers": {
    "ipgeolocation": {
      "command": "npx",
      "args": ["-y", "ipgeolocation-io-mcp@latest"],
      "env": {
        "IPGEOLOCATION_API_KEY": "<YOUR_API_KEY>"
      }
    }
  }
}
```

3. Reload the server or restart your client.
4. Ask **"Where is 8.8.8.8 located?"**

## Table of Contents

- [Quick Start](#quick-start)
- [Install by Client](#install-by-client)
- [Verify It Works](#verify-it-works)
- [Tools by Plan](#tools-by-plan)
- [Tool Reference](#tool-reference)
- [Prompt Examples](#prompt-examples)
- [Example Answers and Tool Output](#example-answers-and-tool-output)
- [Error Codes](#error-codes)
- [How It Works](#how-it-works)
- [Caching](#caching)
- [Cached Result Pagination](#cached-result-pagination)
- [Environment Variables](#environment-variables)
- [Building from Source](#building-from-source)
- [Docker](#docker)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Pricing](#pricing)
- [Links](#links)
- [License](#license)
- [Privacy Policy](#privacy-policy)

## Install by Client

### Requirements

- Node.js 22 or later for npm/source installs, or a bundle host with a compatible Node.js runtime
- `npx` available for the npm configuration examples
- An IPGeolocation.io API key for most API tools

Use a supported Node.js release with its latest security updates.

`get_my_ip` requires no API key. The other 15 API tools require one. `get_cached_result` reads results already held in memory; use the same API key as the original lookup.

[Sign up for a free IPGeolocation.io API key](https://app.ipgeolocation.io/signup)

Use a private user configuration or your client's secret/environment settings for the real key. Keep keys out of committed project configuration. Each client below uses the [Quick Start server entry](#quick-start) unless its format differs.

### Codex CLI

Set `IPGEOLOCATION_API_KEY` in your private shell environment before running these commands. The variable reference keeps the key value out of the command you type and its shell history.

```bash
codex mcp add ipgeolocation --env "IPGEOLOCATION_API_KEY=$IPGEOLOCATION_API_KEY" -- npx -y ipgeolocation-io-mcp@latest
codex mcp list
```

Start a new Codex session after adding the server.

### Claude Desktop

Install the published server from its [Claude Marketplace listing](https://claude.com/marketplace/connectors/ipgeolocation-io-mcp-server). In Claude Desktop, open **Settings > Extensions > Browse extensions**, find **IPGeolocation.io MCP Server**, and configure your API key during installation. See [Anthropic's desktop extension guide](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop). The directory distributes the approved published bundle; its refresh can lag GitHub Releases. Check the installed version, or download the versioned bundle below.

For manual npm configuration, open **Settings > Developer > Edit Config** in Claude Desktop. This opens `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Merge the [Quick Start entry](#quick-start) into `mcpServers`.

Fully quit and reopen Claude Desktop after saving. See the [official local-server setup guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers).

For clients that install MCP Bundles, download the published [v2.0.2 `.mcpb` bundle](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases/download/v2.0.2/ipgeolocation-ipgeolocation-io-mcp-2.0.2.mcpb) from [GitHub Releases](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases). The bundle contains the server and its dependencies; its host still needs a Node.js 22+ runtime. Enter your API key when the host prompts for bundle configuration.

### Cline

In Cline, open **MCP Servers > Configure > Configure MCP Servers**. Add the [Quick Start entry](#quick-start) under `mcpServers` in the settings JSON. Cline CLI uses `~/.cline/data/settings/cline_mcp_settings.json` by default. See [Cline's MCP guide](https://docs.cline.bot/mcp/mcp-overview).

Restart Cline after saving.

### Cursor

One-click install:

[![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/install-mcp?name=ipgeolocation&config=eyJ0eXBlIjoic3RkaW8iLCJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImlwZ2VvbG9jYXRpb24taW8tbWNwQGxhdGVzdCJdLCJlbnYiOnsiSVBHRU9MT0NBVElPTl9BUElfS0VZIjoiIn19)

Or add to `.cursor/mcp.json` for this project, or `~/.cursor/mcp.json` for all projects. See [Cursor's MCP guide](https://cursor.com/docs/mcp).

```json
{
  "mcpServers": {
    "ipgeolocation": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "ipgeolocation-io-mcp@latest"],
      "env": {
        "IPGEOLOCATION_API_KEY": "<YOUR_API_KEY>"
      }
    }
  }
}
```

Restart Cursor after saving.

#### Cursor plugin

This repository includes a Cursor plugin for `ipgeolocation-io-mcp`. The plugin runs locally over stdio and requires Node.js 22 or later.

To install it locally, clone this repository into a new directory under `~/.cursor/plugins/local/`, reload Cursor, and open **Customize > Plugins**.

- **Local plugin:** set `IPGEOLOCATION_API_KEY` in the environment that launches Cursor. The plugin reads the key from that environment.
- **Marketplace install:** set the key in the plugin's private configuration.

With an empty or unset API key, `get_my_ip` still works. API tools that require a key return a missing-key error without sending a request.

To load a local checkout in Cursor CLI:

```bash
agent --plugin-dir /absolute/path/to/ipgeolocation-io-mcp
```

API requests that need a key use your account's plan and credits. The `get_cached_result` tool reads saved response pages without making another API request.

Install this server by only one method, because using more than one creates duplicate tool entries. You can keep any other servers in your existing configuration.

### Windsurf / Cascade

In Cascade's **... (Actions)** menu, choose **Open MCP config file** in the MCPs section. Merge the [Quick Start entry](#quick-start) into the file opened by your installed version; configuration paths vary by release. See the [vendor's Cascade MCP guide](https://docs.devin.ai/desktop/cascade/mcp) for the active agent and configuration location in newer releases.

Save the file and reload the server in the client.

### Kiro Powers

The [Kiro Power](packaging/kiro/README.md) provides 17 tools for IP geolocation, company information, ASN and network data, IP security (VPN, proxy, Tor, bot, hosting and spam detection), abuse contacts, time zones, astronomy, currency data and user-agent parsing. It runs `ipgeolocation-io-mcp` locally over stdio, follows npm's `latest` tag and requires Node.js 22 or later. Import the `packaging/kiro` folder through **Powers > Add Custom Power** and follow the setup guide to configure your private API key. Most tools require a key; access and credits depend on your plan.

### VS Code / GitHub Copilot

Run **MCP: Add Server** from the Command Palette, choose a local command, and use `npx -y ipgeolocation-io-mcp@latest`. Choose **Copilot Global** for private user settings or **.mcp.json** for a portable workspace configuration. Add `IPGEOLOCATION_API_KEY` to the server's environment.

The portable `.mcp.json` format uses the top-level `mcpServers` object shown in [Quick Start](#quick-start).

Use the server's **Start** action and approve its configuration when prompted. Existing `.vscode/mcp.json` files use a top-level `servers` object instead. See [VS Code's MCP setup guide](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

### Glama

You can try the server on [Glama](https://glama.ai/mcp/servers/IPGeolocation/ipgeolocation-io-mcp) directly. Only `IPGEOLOCATION_API_KEY` is required. Leave other environment variable fields empty unless you want to change cache, timeout, or output limits.

If you don't have a key yet, [create a free IPGeolocation.io API key](https://app.ipgeolocation.io/signup).

### Any Other MCP Client

Use the `ipgeolocation` server entry from [Quick Start](#quick-start) in your client's configuration format. The client must support launching a local `stdio` process. A client that accepts only a remote MCP URL needs a hosted endpoint; this package supplies the server command.

## Verify It Works

Try these after setup:

| Prompt | Expected tool |
|--------|---------------|
| Where is 8.8.8.8 located? | `lookup_ip` |
| For IP 49.12.212.42, give me threat indicators, company, ASN, and city. | `lookup_ip` with `fields` and `include=security` |
| Show threat indicators and the abuse contact email for 2.56.12.11. | `lookup_ip` with `include=security,abuse` |
| For AS1, list upstream ASN numbers only. | `lookup_asn` with `include=upstreams` |
| Convert 2026-03-07 09:30 from New York to Tokyo time. | `convert_timezone` |
| Give sunrise times for Karachi from 2026-03-10 to 2026-03-15. | `get_astronomy_time_series` |
| Parse this user agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 | `parse_user_agent` |

## Tools by Plan

Version 2.0.3 exposes 16 API tools and `get_cached_result`, a zero-credit page reader. Bulk tools accept 250 inputs by default; the effective ceiling is the lower of the two [item-limit settings](#environment-variables).

Listed costs apply to successful upstream requests. Cache hits and cached-page reads use no additional credits. The API's `X-Credits-Charged` response header establishes actual billing; see the [credit rules](https://ipgeolocation.io/documentation/credits-usage.html).

### Free Plan

The free plan provides 1,000 API credits per day. These 7 API tools provide their core data; `get_cached_result` also reads saved pages for 0 credits:

| Tool | Credits | What it does |
|------|---------|--------------|
| `lookup_ip` | 1 | Location, time zone, currency, ASN for one IP |
| `get_my_ip` | 0 | Public IP of the machine running the server |
| `lookup_currency` | 1 | Currency and country metadata for one IP |
| `get_timezone` | 1 | Time zone by name, location, IP, airport code, or UN/LOCODE |
| `convert_timezone` | 1 | Convert time between two locations |
| `get_astronomy` | 1 | Sunrise, sunset, moonrise, moonset, twilight, moon phase for one date |
| `get_astronomy_time_series` | 1 | Daily astronomy data for a date range (up to 90 days) |

Company details, network data, security, abuse contacts and bulk geolocation require a paid plan. `lookup_company` can return basic ASN ownership on Free, but not company details. On Free, `include=*` returns base IP data only; it does not unlock paid features. See the [API plan documentation](https://ipgeolocation.io/documentation/ip-location-api.html) for current access rules.

### Paid Plans

All 17 tools, including the zero-credit cached result reader. Paid plans also add `network`, `company`, and extended `asn` fields to `lookup_ip`, plus the `include` parameter for `security`, `abuse`, `hostname`, `liveHostname`, `hostnameFallbackLive`, `user_agent`, `geo_accuracy`, `dma_code`, or `*`.

| Tool | Credits | What it does |
|------|---------|--------------|
| `bulk_lookup_ip` | 1 per IP | Batch geolocation, 250 inputs by default |
| `check_security` | 2 | VPN, proxy, Tor, bot, spam, and threat flags |
| `bulk_security_check` | 2 per IP | Batch threat checks |
| `lookup_company` | 1 | Company name and ASN holder for one IP |
| `lookup_network` | 1 | Route prefix, connection type, anycast status |
| `parse_user_agent` | 1 | Parse one UA string into browser, device, OS, engine |
| `bulk_parse_user_agent` | 1 per UA | Batch UA parsing, 250 strings by default |
| `lookup_asn` | 1 | ASN details, peers, upstreams, downstreams, routes, WHOIS |
| `get_abuse_contact` | 1 | Abuse contact emails, phone, address, route |

**Credit math for `lookup_ip` with `include`:**

| Combination | Total credits |
|-------------|---------------|
| Base lookup | 1 |
| `include=security` | 3 |
| `include=abuse` | 2 |
| `include=*` (Paid, unfiltered) | 4 |
| `include=*` (Free, base only) | 1 |
| `include=security&fields=security` | 2 |
| `include=abuse&fields=abuse` | 1 |

For current plan details and pricing, see the [IPGeolocation.io pricing page](https://ipgeolocation.io/pricing.html).

## Tool Reference

The [full reference](REFERENCE.md#tool-reference) lists parameters and response formats. These are the 17 available tools:

### lookup_ip

IP location, company information, ASN and network data, with optional security and abuse details. [Parameters](REFERENCE.md#lookup_ip).

### bulk_lookup_ip

IP lookups in batches of up to 250 by default. [Parameters](REFERENCE.md#bulk_lookup_ip).

### get_my_ip

The public IP of the machine running the server. No API key or credits needed. [Parameters](REFERENCE.md#get_my_ip).

### check_security

VPN, proxy, Tor, bot, hosting, spam and other threat indicators for an IP. [Parameters](REFERENCE.md#check_security).

### bulk_security_check

Security checks for a batch of IPs. [Parameters](REFERENCE.md#bulk_security_check).

### get_timezone

Current local time and time zone details for a place. [Parameters](REFERENCE.md#get_timezone).

### convert_timezone

Time conversion between two places. [Parameters](REFERENCE.md#convert_timezone).

### get_astronomy

Sun and moon data for one place and date. [Parameters](REFERENCE.md#get_astronomy).

### get_astronomy_time_series

Daily astronomy data for a date range of up to 90 days. [Parameters](REFERENCE.md#get_astronomy_time_series).

### parse_user_agent

Browser, operating system and device details from a supplied user-agent string. [Parameters](REFERENCE.md#parse_user_agent).

### bulk_parse_user_agent

User-agent parsing for a batch of supplied strings. [Parameters](REFERENCE.md#bulk_parse_user_agent).

### lookup_company

Company information and ASN ownership for an IP. Company details require a paid plan. [Parameters](REFERENCE.md#lookup_company).

### lookup_currency

Currency and country metadata for an IP. [Parameters](REFERENCE.md#lookup_currency).

### lookup_network

Route prefix, connection type and anycast status for an IP. [Parameters](REFERENCE.md#lookup_network).

### lookup_asn

ASN details, network relationships, routes and WHOIS data. [Parameters](REFERENCE.md#lookup_asn).

### get_abuse_contact

Abuse reporting contacts for an IP. [Parameters](REFERENCE.md#get_abuse_contact).

### get_cached_result

Remaining pages of a saved result, without another API call or additional credits. [Parameters](REFERENCE.md#get_cached_result).

## Prompt Examples

Ask for the information you need in your own words. Available data and credit use depend on your plan.

IP location is an estimate. Threat scores and VPN/proxy flags are signals to investigate, not a guarantee that traffic is safe or harmful. Missing or unknown values do not mean `false`.

### Inspect IP threat indicators

- Show the threat indicators and city for 49.12.212.42 so I can assess it against our network policy.
- Check these IPs for VPN, proxy, Tor, bot, and spam indicators: 49.12.212.42, 2.56.12.11, 8.8.8.8
- For 49.12.212.42, tell me the threat score, whether it is a cloud provider, and whether it looks like a relay.

### Find who owns an IP

- Who uses 1.1.1.1 and which ASN routes it?
- For AS24940, list upstream ASN numbers only.
- Is this IP anycast and what route prefix is announced for it: 1.1.1.1

### Get abuse contacts

- For IP 2.56.12.11, give me the abuse contact email, phone number, and organization.
- I need the abuse contact for 1.0.0.0 and the network route involved.
- For this IP, show me the abuse contact details only: 1.1.1.1

<a id="timezone-lookups-and-conversions"></a>

### Time zone lookups and conversions

- What time is it in Tokyo right now?
- Convert 2026-03-07 09:30 from New York to Tokyo time.
- What is the current local time at JFK airport?

### Sunrise, sunset, and moon data

- Give sunrise and sunset for London on 2026-06-21.
- Show sunrise times in Karachi from 2026-03-10 to 2026-03-15.
- For New York, give me moon phase and day length on 2026-07-17.

### Parse user-agent strings

- Parse this user agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10\_11\_2) AppleWebKit/601.3.9 (KHTML, like Gecko) Version/9.0.2 Safari/601.3.9
- Parse these user agents in bulk and tell me the browser, OS, and device type for each.
- Does this user agent look like a crawler or bot? Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/41.0.2272.96 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)

## Example Answers and Tool Output

The examples illustrate the format; lookup data can change.

### Single IP lookup

See the [IP lookup example](REFERENCE.md#single-ip-lookup).

### Time conversion

See the [time conversion example](REFERENCE.md#time-conversion).

### Abuse contact

See the [abuse contact example](REFERENCE.md#abuse-contact).

## Error Codes

Errors explain what failed and suggest a next step. Start with [Troubleshooting](#troubleshooting) for common problems, or see the [error reference](REFERENCE.md#error-codes) when handling errors in code.

A failed or cancelled request may already have used API credits. Check the error guidance before retrying. For bulk results, retry only eligible failed inputs; successful inputs do not need another lookup.

## How It Works

Your MCP client starts this server as a local process and makes its tools available in your conversation. The server checks each request, then returns a cached result or calls the IPGeolocation.io API.

Lookups send the requested inputs to IPGeolocation.io. Cached results stay in memory; your client or host controls its own configuration and logs. See the [Security Policy](SECURITY.md) for data handling.

When you omit an IP address, tools that support this use the server machine's public IP. That can differ from your own IP. Security tools return IP intelligence; they do not run the separate browser-based Real-Time Proxy & VPN Detection service.

## Caching

Most lookup results are cached for five minutes by default. Reusing a cached result costs no additional API credits. Current-time tools (`get_timezone`, `convert_timezone`, `get_astronomy`) and `get_my_ip` always call the API.

Saved pages remain available for five minutes after the last successful page read by default. Cached data can also disappear when the cache fills or the server restarts. Reading an unavailable page costs no credits, but repeating the original lookup can use credits again.

`force_refresh: true` requests fresh data and can use credits. See the [cache reference](REFERENCE.md#caching) for expiry, shared results and refresh rules.

## Environment Variables

Most users only need to set `IPGEOLOCATION_API_KEY` in their client's private server settings. Leave optional settings unset unless you need to change the defaults.

| Setting | Default | Purpose |
| --- | --- | --- |
| `IPGEOLOCATION_API_KEY` | Not set | Your API key; required for all API tools except `get_my_ip`. |
| `IPGEOLOCATION_REQUEST_TIMEOUT_MS` | `15000` (15 seconds) | How long to wait for an API response. |
| `IPGEOLOCATION_MCP_CACHE_TTL_MS` | `300000` (5 minutes) | How long to keep lookup results and idle result pages. |

The [configuration reference](REFERENCE.md#environment-variables) lists all settings, limits and allowed values. Larger limits can require more memory.

## Cached Result Pagination

Large results can arrive in pages. The `get_cached_result` tool reads the remaining pages without another API call or additional credits. It also costs nothing if a page is unavailable.

Keep the same server process and API key while reading pages. Saved pages expire after five minutes without a successful read by default, and the cache can remove them sooner if it fills. If the full result is too large to save, the lookup returns an error without a page cursor; the API may already have used credits.

For client developers, the [pagination reference](REFERENCE.md#cached-result-pagination) explains the page fields and includes a complete retrieval example.

## Building from Source

See [Building from Source](CONTRIBUTING.md#building-from-source) for build commands and MCP Inspector setup. Source installations run the code in your checkout, including any unreleased changes.

## Docker

```bash
docker build -t ipgeolocation-mcp .
docker run --rm -i -e IPGEOLOCATION_API_KEY ipgeolocation-mcp
```

Set `IPGEOLOCATION_API_KEY` in your private shell environment first. The image includes Node.js and runs as the unprivileged `node` user. [Docker's `-i` flag](https://docs.docker.com/reference/cli/docker/container/run/#interactive) keeps stdin open for MCP messages. Omit `-t` so the protocol uses ordinary stdin/stdout.

Rebuild the image when you update the source or need a newer runtime.

After building the image, configure a local-command MCP client with:

```json
{
  "mcpServers": {
    "ipgeolocation": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "-e", "IPGEOLOCATION_API_KEY", "ipgeolocation-mcp"],
      "env": {
        "IPGEOLOCATION_API_KEY": "<YOUR_API_KEY>"
      }
    }
  }
}
```

## Testing

See [Testing](CONTRIBUTING.md#testing) for the offline suite and separate live API checks. Live checks can use credits.

## Troubleshooting

**Client uses an old tool after updating:** Restart the server process and check its version in your client's MCP connection details. Compare it with the [latest npm version](https://www.npmjs.com/package/ipgeolocation-io-mcp). Rebuild source and Docker installations before restarting them.

**API key not configured:** Set `IPGEOLOCATION_API_KEY` in your client's server configuration. This local error has no HTTP status and makes no upstream request.

**401 errors:** The API rejected the key or requested capability. Check that the key is active and the plan supports the tool. Domain lookups in `lookup_ip` also require a paid plan.

**423 errors:** Use a public routable IP. Private/bogon addresses such as `10.0.0.1` and reserved documentation addresses such as `203.0.113.42` cannot be used as successful geolocation examples.

**Network requires a proxy:** See the [proxy setup instructions](REFERENCE.md#network-proxies) for supported Node.js versions and settings.

**Timeout:** Check the connection and the error guidance before retrying; the API may already have used credits. If requests need longer, adjust `IPGEOLOCATION_REQUEST_TIMEOUT_MS` within the [allowed range](REFERENCE.md#environment-variables).

**Redirect blocked:** The server received an unexpected HTTP redirect and stopped before forwarding credentials or request data. Do not retry automatically. Investigate the API endpoint or contact support with the sanitized error.

**Cached result unavailable:** The cursor belongs to another key or process, or the snapshot expired or was evicted. The failed page read made no API call. A new lookup can consume credits.

**Resource limit:** Check the error's guidance before trying again. The server rejects oversized tool arguments before making an API request. A response can exceed a limit after the API has used credits. Another lookup can use more credits. Reducing displayed fields does not always reduce the API response size. If you received a page cursor, use `get_cached_result` to read the remaining data without another API request. Raise limits only when the server has enough memory.

**Client asks for an MCP URL:** This package supplies a local `stdio` command. Use a client or host that can launch it; a remote-only connector needs a hosted MCP endpoint.

## Pricing

For current plan details, credits, and pricing, see the [IPGeolocation.io pricing page](https://ipgeolocation.io/pricing.html).

## Links

- [IPGeolocation.io Website](https://ipgeolocation.io)
- [IPGeolocation.io API Documentation](https://ipgeolocation.io/documentation.html)
- [IPGeolocation.io Pricing](https://ipgeolocation.io/pricing.html)
- [Create a Free IPGeolocation.io API Key](https://app.ipgeolocation.io/signup)
- [Tool and Configuration Reference](REFERENCE.md)
- [Changelog](CHANGELOG.md)
- [Security Policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Release Checklist](RELEASING.md)

## License

[MIT](LICENSE)

## Privacy Policy

API lookups send the requested inputs to IPGeolocation.io, which also receives the server machine's public egress IP. The server caches results in process memory. Your MCP client or hosting provider controls its own configuration and log storage. See the [Security Policy](SECURITY.md#lookup-data-and-caching) for retention details and the [IPGeolocation.io Privacy Policy](https://ipgeolocation.io/privacy.html) for provider handling.
