# IPGeolocation.io MCP Server

[![SafeSkill](https://safeskill.dev/api/badge/ipgeolocation-io-mcp)](https://safeskill.dev/scan/ipgeolocation-io-mcp)

[![npm version](https://img.shields.io/npm/v/ipgeolocation-io-mcp?logo=npm&label=npm&color=CB3837)](https://www.npmjs.com/package/ipgeolocation-io-mcp)
[![GitHub release](https://img.shields.io/github/v/release/IPGeolocation/ipgeolocation-io-mcp?logo=github&label=release&color=181717)](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-live-0A7CFF?logo=modelcontextprotocol&logoColor=white)](https://registry.modelcontextprotocol.io/?q=ipgeolocation)
[![Glama](https://img.shields.io/badge/Glama-listed-0A7CFF)](https://glama.ai/mcp/servers/IPGeolocation/ipgeolocation-io-mcp)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/IPGeolocation/ipgeolocation-io-mcp/badge)](https://scorecard.dev/viewer/?uri=github.com/IPGeolocation/ipgeolocation-io-mcp)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-5FA04E?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-16A34A)](https://github.com/IPGeolocation/ipgeolocation-io-mcp/blob/main/LICENSE)

Use the official [IPGeolocation.io](https://ipgeolocation.io) MCP server for IP geolocation, security indicators, ASN data, and abuse contacts. It also provides time zone conversions, sun and moon data, and user-agent parsing.

MCP (Model Context Protocol) connects your client to these tools. Your client or host must support launching a local command over `stdio`. See [Install by Client](#install-by-client) for configuration examples.

**This README describes [2.0.1](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases/tag/v2.0.1).** The `npx` commands and Cursor install link below install the latest published npm package. See the [changelog](CHANGELOG.md) for changes to pagination, limits, and error handling.

| Item | Value |
|------|-------|
| Package | `ipgeolocation-io-mcp` |
| Version | `2.0.1` |
| Release date | 2026-10-11 |
| Transport | `stdio` |
| Node.js | `>=22` |

## Quick Start

1. [Create a free IPGeolocation API key](https://app.ipgeolocation.io/signup).
2. Merge this entry into your client's private configuration, keeping any existing servers. See [Install by Client](#install-by-client) for the configuration location. Cursor also has a [one-click installer](#cursor).

```json
{
  "mcpServers": {
    "ipgeolocation": {
      "command": "npx",
      "args": ["-y", "ipgeolocation-io-mcp"],
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

[Sign up for a free IPGeolocation API key](https://app.ipgeolocation.io/signup)

Use a private user configuration or your client's secret/environment settings for the real key. Keep keys out of committed project configuration. Each client below uses the [Quick Start server entry](#quick-start) unless its format differs.

### Codex CLI

Set `IPGEOLOCATION_API_KEY` in your private shell environment before running these commands. The variable reference keeps the key value out of the command you type and its shell history.

```bash
codex mcp add ipgeolocation --env "IPGEOLOCATION_API_KEY=$IPGEOLOCATION_API_KEY" -- npx -y ipgeolocation-io-mcp
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

For clients that install MCP Bundles, download the published [v2.0.1 `.mcpb` bundle](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases/download/v2.0.1/ipgeolocation-ipgeolocation-io-mcp-2.0.1.mcpb) from [GitHub Releases](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases). The bundle contains the server and its dependencies; its host still needs a Node.js 22+ runtime. Enter your API key when the host prompts for bundle configuration.

### Cline

In Cline, open **MCP Servers > Configure > Configure MCP Servers**. Add the [Quick Start entry](#quick-start) under `mcpServers` in the settings JSON. Cline CLI uses `~/.cline/data/settings/cline_mcp_settings.json` by default. See [Cline's MCP guide](https://docs.cline.bot/mcp/mcp-overview).

Restart Cline after saving.

### Cursor

One-click install:

[![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/install-mcp?name=ipgeolocation&config=eyJ0eXBlIjoic3RkaW8iLCJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImlwZ2VvbG9jYXRpb24taW8tbWNwIl0sImVudiI6eyJJUEdFT0xPQ0FUSU9OX0FQSV9LRVkiOiIifX0%3D)

Or add to `.cursor/mcp.json` for this project, or `~/.cursor/mcp.json` for all projects. See [Cursor's MCP guide](https://cursor.com/docs/mcp).

```json
{
  "mcpServers": {
    "ipgeolocation": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "ipgeolocation-io-mcp"],
      "env": {
        "IPGEOLOCATION_API_KEY": "<YOUR_API_KEY>"
      }
    }
  }
}
```

Restart Cursor after saving.

### Windsurf / Cascade

In Cascade's **... (Actions)** menu, choose **Open MCP config file** in the MCPs section. Merge the [Quick Start entry](#quick-start) into the file opened by your installed version; configuration paths vary by release. See the [vendor's Cascade MCP guide](https://docs.devin.ai/desktop/cascade/mcp) for the active agent and configuration location in newer releases.

Save the file and reload the server in the client.

### VS Code / GitHub Copilot

Run **MCP: Add Server** from the Command Palette, choose a local command, and use `npx -y ipgeolocation-io-mcp`. Choose **Copilot Global** for private user settings or **.mcp.json** for a portable workspace configuration. Add `IPGEOLOCATION_API_KEY` to the server's environment.

The portable `.mcp.json` format uses the top-level `mcpServers` object shown in [Quick Start](#quick-start).

Use the server's **Start** action and approve its configuration when prompted. Existing `.vscode/mcp.json` files use a top-level `servers` object instead. See [VS Code's MCP setup guide](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

### Glama

You can try the server on [Glama](https://glama.ai/mcp/servers/IPGeolocation/ipgeolocation-io-mcp) directly. Only `IPGEOLOCATION_API_KEY` is required. Leave other environment variable fields empty unless you want to change cache, timeout, or output limits.

If you don't have a key yet, [create a free IPGeolocation API key](https://app.ipgeolocation.io/signup).

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

Version 2.0.1 exposes 16 API tools and `get_cached_result`, a zero-credit page reader. Bulk tools accept 250 inputs by default; the effective ceiling is the lower of the two [item-limit settings](#environment-variables).

Listed costs apply to successful upstream requests. Cache hits and cached-page reads use no additional credits. The API's `X-Credits-Charged` response header establishes actual billing; see the [credit rules](https://ipgeolocation.io/documentation/credits-usage.html).

### Free Plan

1,000 credits per day. These 7 API tools provide their documented core data; `get_cached_result` also reads previously returned pages for 0 credits:

| Tool | Credits | What it does |
|------|---------|--------------|
| `lookup_ip` | 1 | Location, timezone, currency, ASN for one IP |
| `get_my_ip` | 0 | Public IP of the machine running the server |
| `lookup_currency` | 1 | Currency and country metadata for one IP |
| `get_timezone` | 1 | Timezone by name, location, IP, airport code, or UN/LOCODE |
| `convert_timezone` | 1 | Convert time between two locations |
| `get_astronomy` | 1 | Sunrise, sunset, moonrise, moonset, twilight, moon phase for one date |
| `get_astronomy_time_series` | 1 | Daily astronomy data for a date range (up to 90 days) |

`lookup_company` also returns basic ASN ownership on free plans, without company details. `lookup_network` returns a local error if the API omits the paid network data. The API documentation describes bulk geolocation as paid-only; live checks with a free-plan key also returned basic bulk results. Plan access is determined upstream, so free bulk support should not be assumed from this observation.

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
| `include=*` | 4 |
| `include=security&fields=security` | 2 |
| `include=abuse&fields=abuse` | 1 |

For current plan details and pricing, see the [IPGeolocation pricing page](https://ipgeolocation.io/pricing.html).

## Tool Reference

Tool arguments must match the advertised schema. Unknown parameters are rejected locally before any API request, so a misspelled selector cannot silently look up the server's IP.

Coordinates, including conversion selectors, and `elevation` take string values, such as `"24.86"` and `"10"`. `force_refresh` takes a boolean.

### lookup_ip

Single IP or domain lookup through the [IP Geolocation API](https://ipgeolocation.io/documentation/ip-location-api.html). **Free and paid. 1 credit for base IP data.**

Use this when you need location, timezone, currency, or ASN for one IP address. On paid plans you can add `include` modules to pull security, abuse, or hostname data in the same call, which avoids extra requests.

Free plan returns base location, country metadata, currency, timezone, and basic ASN. Paid plans add `network`, `company`, extended ASN, and the `include` parameter. Note that domain lookups require a paid plan.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ip` | No | IPv4, IPv6, or domain. Domain lookup requires a paid plan. |
| `lang` | No | Response language. Non-English requires a paid plan. |
| `include` | No | Extra modules: `security`, `abuse`, `hostname`, `liveHostname`, `hostnameFallbackLive`, `user_agent`, `geo_accuracy`, `dma_code`, or `*` |
| `fields` | No | Comma-separated fields to return |
| `excludes` | No | Comma-separated fields to exclude |
| `force_refresh` | No | Skip the cache and hit the API directly |

Tip: combining `include` with `fields` can cut your credit cost. For example, `include=security&fields=security` costs 2 credits instead of 3 because you skip the base geolocation response. Similarly, `include=abuse&fields=abuse` costs 1 credit instead of 2.

Fields enable the optional modules they need. These modules require a paid plan:

| Selected field | Enabled module |
|----------------|----------------|
| `security.is_vpn` | `security` |
| `location.accuracy_radius`, `location.confidence`, or `location.locality` | `geo_accuracy` |
| `location.dma_code` | `dma_code` |

Accuracy and DMA values appear inside `location`. An explicit include keeps its module present even if `fields` omits it. You can exclude nested fields, but a root named by `fields` or an explicit include stays present. `include=*` follows field selection and exclusions without protecting those roots. Cached results follow the same rules as fresh responses.

### bulk_lookup_ip

Batch IP lookup. **Paid. 1 credit per IP.**

Takes an array of IPs or domains (up to 250 by default). The batch limit is the lower of `IPGEOLOCATION_MCP_MAX_BULK_ITEMS` and `IPGEOLOCATION_MCP_MAX_RESULT_ITEMS`. Supports the same `include`, `fields`, and `excludes` options as `lookup_ip`.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ips` | Yes | Array of IP addresses or domains |
| `lang` | No | Response language |
| `include` | No | Extra modules per IP |
| `fields` | No | Comma-separated fields to return per IP |
| `excludes` | No | Comma-separated fields to exclude per IP |
| `force_refresh` | No | Skip the cache |

### get_my_ip

Returns the public IP of the machine running the server. **Free. 0 credits. No API key needed.**

Takes no parameters. Always hits the network (not cached). Useful as a quick check to confirm the server process is up.

### check_security

Threat and anonymity data for one IP through the [IP Security API](https://ipgeolocation.io/documentation/ip-security-api.html). **Paid. 2 credits.**

Returns threat score, VPN/proxy/Tor flags, provider names, confidence scores, bot/spam indicators, anonymity flags, and cloud-provider status.

If the same prompt also asks for location or ASN, use `lookup_ip` with `include=security` to get them in one request. It costs 3 credits, the same as a separate security check and base lookup. Add `abuse` to `include` when abuse contacts are also needed.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ip` | No | IP address to check |
| `fields` | No | Comma-separated fields to return |
| `excludes` | No | Comma-separated fields to exclude |
| `force_refresh` | No | Skip the cache |

### bulk_security_check

Batch version of `check_security`. **Paid. 2 credits per IP.** Accepts up to 250 inputs by default, subject to the same bulk limits as `bulk_lookup_ip`.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ips` | Yes | Array of IP addresses |
| `fields` | No | Comma-separated fields to return per IP |
| `excludes` | No | Comma-separated fields to exclude per IP |
| `force_refresh` | No | Skip the cache |

### get_timezone

Current time and timezone details for a location through the [Time Zone API](https://ipgeolocation.io/documentation/timezone-api.html). **Free and paid. 1 credit.**

Accepts IANA timezone names, coordinates, IP addresses, airport codes (IATA/ICAO), or UN/LOCODEs. The response includes timezone offsets, date/datetime variants, `current_time`, `current_time_unix`, `time_24`, `time_12`, `week`, `month`, `year`, timezone abbreviations, and DST transition details.

With no selector, the API uses the server machine's public egress IP, which can differ from your IP.

Always hits the network (not cached) because it returns the current time.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `tz` | No | IANA timezone name (e.g., `America/New_York`) |
| `lat` + `long` | No | Latitude and longitude |
| `location` | No | City or address string |
| `ip` | No | IP address |
| `iata_code` | No | IATA airport code |
| `icao_code` | No | ICAO airport code |
| `lo_code` | No | UN/LOCODE |
| `lang` | No | Response language. Non-English requires a paid plan. |

### convert_timezone

Converts a time between two locations. **Free and paid. 1 credit.**

Provide one source selector and one destination selector using an IANA time zone, coordinates, a city/address, an airport code, or a UN/LOCODE. If you omit `time`, the API converts the current time. This tool does not accept IP selectors or `lang` and always calls the API (not cached).

| Parameter | Required | Description |
|-----------|----------|-------------|
| `time` | No | `yyyy-MM-dd HH:mm` or `yyyy-MM-dd HH:mm:ss`. Defaults to now. |
| `tz_from` / `tz_to` | No | IANA timezone names |
| `lat_from` + `long_from` | No | Source coordinates |
| `lat_to` + `long_to` | No | Destination coordinates |
| `location_from` / `location_to` | No | City/address strings |
| `iata_from` / `iata_to` | No | IATA airport codes |
| `icao_from` / `icao_to` | No | ICAO airport codes |
| `locode_from` / `locode_to` | No | UN/LOCODEs |

### get_astronomy

Sun and moon data for one location on one date through the [Astronomy API](https://ipgeolocation.io/documentation/astronomy-api.html). **Free and paid. 1 credit.**

Returns sunrise, sunset, moonrise, moonset, morning and evening twilight, solar noon, day length, moon phase, sun/moon status flags, and live sun/moon position (altitude, azimuth).

This tool always calls the API, including when `date` is set; it does not use the response cache.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `lat` + `long` | No | Coordinates (highest priority when given) |
| `location` | No | City or address |
| `ip` | No | IP address |
| `date` | No | `YYYY-MM-DD`. Defaults to today. |
| `elevation` | No | Meters, 0 to 10000 |
| `time_zone` | No | IANA name to control output times |
| `lang` | No | Response language. Non-English requires a paid plan. |

### get_astronomy_time_series

Astronomy data for a date range, up to 90 days. **Free and paid. 1 credit per request.**

Each daily entry includes `mid_night`, `night_end`, `morning`, `sunrise`, `sunset`, `evening`, `night_begin`, `sun_status`, `solar_noon`, `day_length`, `moon_phase`, `moonrise`, `moonset`, and `moon_status`. Use this instead of calling `get_astronomy` repeatedly for a range.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `dateStart` | Yes | Start date (`YYYY-MM-DD`) |
| `dateEnd` | Yes | End date (`YYYY-MM-DD`). Max span: 90 days. |
| `lat` + `long` | No | Coordinates (highest priority when given) |
| `location` | No | City or address |
| `ip` | No | IP address |
| `elevation` | No | Meters |
| `time_zone` | No | IANA name to control output times |
| `lang` | No | Response language. Non-English requires a paid plan. |
| `force_refresh` | No | Skip the cache |

### parse_user_agent

Parses one UA string into browser, device, OS, and engine data through the [User-Agent API](https://ipgeolocation.io/documentation/user-agent-api.html). **Paid. 1 credit.**

Also classifies bots and crawlers. Note: this parses the `uaString` you pass in. It does not infer a caller UA from the MCP connection itself.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `uaString` | Yes | The user-agent string to parse |
| `force_refresh` | No | Skip the cache |

Returns `name`, `type`, `version`, `device`, `engine`, and `operating_system`.

### bulk_parse_user_agent

Batch version of `parse_user_agent`. **Paid. 1 credit per string.**

Takes up to 250 strings per request by default. The batch limit is the lower of `IPGEOLOCATION_MCP_MAX_BULK_ITEMS` and `IPGEOLOCATION_MCP_MAX_RESULT_ITEMS`.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `uaStrings` | Yes | Array of user-agent strings |
| `force_refresh` | No | Skip the cache |

### lookup_company

Company details and ASN ownership for one IP. **Company details require paid; free plans return basic ASN only. 1 credit.**

Returns `company` and `asn` objects. `lookup_ip` returns the same data plus location, timezone, and more. Use this when the company/ASN pair is all you need and you want a smaller response.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ip` | No | IP address |
| `force_refresh` | No | Skip the cache |

### lookup_currency

Currency, country calling code, TLD, and languages for one IP. **Free and paid. 1 credit.**

Returns `currency` and `country_metadata` objects.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ip` | No | IP address |
| `force_refresh` | No | Skip the cache |

### lookup_network

Route prefix, connection type, and anycast status for one IP. **Paid. 1 credit.**

Returns a `network` object with `connection_type`, `route`, and `is_anycast`. If the API omits network data, the tool returns a local error instead of an empty success. This does not invent an upstream HTTP status, and the API call may already have consumed credits.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ip` | No | IP address |
| `force_refresh` | No | Skip the cache |

### lookup_asn

Network allocation and relationship data through the [ASN API](https://ipgeolocation.io/documentation/asn-api.html). **Paid. 1 credit.**

Use this tool for ASN details and optional peers, upstreams, downstreams, routes, and WHOIS datasets. Request the datasets you need with `include`, then filter the cached result to retrieve different slices. `lookup_ip` also provides ASN metadata as part of an IP lookup.

`fields` automatically enables optional datasets it references, such as `upstreams.as_number`. `excludes` alone does not request extra datasets.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `asn` | No | ASN (e.g., `AS13335` or `13335`) |
| `ip` | No | IP address to resolve to an ASN |
| `include` | No | `peers`, `downstreams`, `upstreams`, `routes`, `whois_response` |
| `fields` | No | Comma-separated fields to return |
| `excludes` | No | Comma-separated fields to exclude |
| `force_refresh` | No | Skip the cache |

### get_abuse_contact

Abuse contact details for one IP through the [IP Abuse Contact API](https://ipgeolocation.io/documentation/ip-abuse-contact-api.html). **Paid. 1 credit.**

Returns the abuse route, country, contact name, organization, address, email addresses, and phone numbers. If you also need geolocation or security data for the same IP, use `lookup_ip` with `include=abuse` (or `include=security,abuse`) to get everything in one call.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ip` | No | IP address |
| `fields` | No | Comma-separated fields to return |
| `excludes` | No | Comma-separated fields to exclude |
| `force_refresh` | No | Skip the cache |

### get_cached_result

Read a page from a previous oversized result. **Free and paid. 0 credits. Added in 2.0.1.**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `cursor` | Yes | The previous response's `page.cursor` to replay it, or `page.next_cursor` to continue |

Use the same server process and API key. Page reads extend the snapshot's idle expiry and never call the API, including on failure. See [Cached Result Pagination](#cached-result-pagination) for the response fields and a complete recovery example.

## Prompt Examples

For a paid IP investigation, call `lookup_ip` once with `ip: "49.12.212.42"`, `include: "security,abuse"`, and `fields: "location,company,asn,security,abuse"`. This combines location, ownership, threat indicators, and abuse contacts for an estimated 4 credits. Describe the evidence and any unknown fields; apply the user's policy before recommending an allow/block decision.

For a mixed batch, call `bulk_lookup_ip` with `ips: ["8.8.8.8", "10.0.0.1", "1.1.1.1"]` and `fields: "location.country_name"`. Inspect `structuredContent.errors` to identify the private input and use the successful records directly. The two valid IP lookups cost an estimated 2 credits; the private IP is not billed. Split larger batches at the advertised input limit.

An **ASN** identifies a network that announces IP routes. **Anycast** lets one IP be served from multiple locations, so its location need not identify the server that handled a particular request. A **bogon** address is reserved or otherwise not publicly routable. **Upstream** in an error means the IPGeolocation.io API contacted by this server.

IP location is an estimate. Use `include=geo_accuracy` where available to assess uncertainty. Threat scores and VPN/proxy flags are signals for investigation, not guarantees of harmless or malicious traffic. Treat missing, null, or unknown indicators as unavailable, not as `false`. Combine location, ownership, security signals, and abuse contacts with your own allow/block policy.

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

### Timezone lookups and conversions

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

The text answers below are illustrative; exact wording depends on the model. JSON blocks are shortened examples, not current measurements. Location, ownership, contacts, and current-time fields can change.

### Single IP lookup

**Prompt:** Locate 91.128.103.196 and give me the country, city, ASN, and local time.

**Example answer:** 91.128.103.196 is in Stockholm, Sweden. ASN is AS1257, operated by Tele2 Sverige AB. Timezone is Europe/Stockholm, local time was 2026-02-12 18:36:54.

```json
{
  "ip": "91.128.103.196",
  "location": {
    "country_name": "Sweden",
    "state_prov": "Stockholms lan",
    "city": "Stockholm"
  },
  "asn": {
    "as_number": "AS1257",
    "organization": "Tele2 Sverige AB",
    "country": "SE"
  },
  "time_zone": {
    "name": "Europe/Stockholm",
    "current_time": "2026-02-12 18:36:54.401+0100"
  }
}
```

### Time conversion

**Prompt:** Convert 2025-01-21 13:42:52 from DXB to LHR.

**Example answer:** 2025-01-21 13:42:52 in Dubai converts to 2025-01-21 09:42:52 in London. The difference is 4 hours.

```json
{
  "original_time": "2025-01-21 13:42:52",
  "converted_time": "2025-01-21 09:42:52",
  "diff_hour": 4,
  "diff_min": 240
}
```

### Abuse contact

**Prompt:** Give me the abuse contact for 1.0.0.0.

**Example answer:** The abuse contact for 1.0.0.0 is IRT-APNICRANDNET-AU in Australia, covering route 1.0.0.0/24. Email: helpdesk@apnic.net.

```json
{
  "ip": "1.0.0.0",
  "abuse": {
    "route": "1.0.0.0/24",
    "country": "AU",
    "name": "IRT-APNICRANDNET-AU",
    "address": "PO Box 3646, South Brisbane, QLD 4101, Australia",
    "emails": ["helpdesk@apnic.net"]
  }
}
```

## Error Codes

Tool failures return `isError: true`, readable text, and `structuredContent.error` with a redacted, length-limited message, category, retryability, and guidance:

| Failure origin | Structured details |
|----------------|--------------------|
| HTTP error response received from the API | `source: "ipgeolocation_api"`; `status` is the received HTTP status |
| Registered-schema rejection: wrong field type, missing required field, unknown parameter, or oversized batch | `source: "mcp_server"`, `category: "validation"`, `retryable: false`; rejected before an API call |
| Handler validation (such as dates or coordinate pairs), missing API key, or unavailable cached result | `source: "mcp_server"`, `category: "tool_error"`, `retryable: false`; no HTTP status is invented |
| Local request timeout | `source: "mcp_server"`, `category: "timeout"`, local `status: 504`, `retryable: true` |
| Connection failure, invalid JSON, or invalid `get_my_ip` provider payload | `source: "mcp_server"`, `category: "upstream_request"`, local `status: 502`, `retryable: true` |
| API returned an HTTP redirect | `source: "mcp_server"`, `category: "redirect_blocked"`, local `status: 502`, `retryable: false`; investigate the redirect or contact support |

Input validation uses the registered Zod schemas and the same structured error envelope as execution failures. Unknown tools and malformed MCP requests produce protocol errors. Retry guidance does not guarantee that a retry will succeed or be free: a local timeout can happen after the API processed a paid request. HTTP 429 is a credit/subscription limit, so immediate automatic retries are disabled; retry after credits become available.

The following table applies to HTTP errors actually received from the API:

| Code | Meaning |
|------|---------|
| `400` | Upstream API rejected the request parameters or input format |
| `401` | API key rejected, free plan calling a paid tool, or non-English `lang` on free plan |
| `404` | Resource not found (e.g., ASN does not exist) |
| `405` | Method or subscription restriction from the upstream API |
| `413` | POST body is larger than the upstream API allows |
| `415` | POST request is missing the required `application/json` content type |
| `423` | Private, reserved, or bogon IP, including documentation addresses such as `203.0.113.42` and `198.51.100.27` |
| `429` | Daily credit limit (free plan) or subscription/surcharge quota exceeded |
| `499` | Upstream API reports a client request or connection timeout |
| `500`, `502`, `503`, `504`, `505` | Upstream API server-side error |

Exact status codes can vary by endpoint and request mode. If an upstream endpoint returns a status outside this table, the server does not guess the cause. It passes the upstream status and message through with `category: "undocumented_api_error"` and adds guidance for the MCP client to explain the response as an undocumented upstream status without inventing a cause.

Bulk text preserves the API's per-item format. Structured results contain `items` in input order plus an `errors` list. Each failed item includes its zero-based `input_index`, original `input`, source, category, message, retryability, and guidance. An item `status` is present only if supplied by the API; message-only errors do not acquire an invented HTTP status. A mismatched result count returns a whole-call error rather than assigning unreliable input identifiers. Inspect every record; overall request success does not establish that every item succeeded, and successful items should not be retried.

## How It Works

Your MCP client uses this server to call the IPGeolocation.io v3 APIs.

At runtime:

1. Your MCP client starts the server process.
2. The client reads the tool list.
3. When a prompt matches a tool, the client calls it.
4. The server validates arguments and returns a cached result or calls the API. It returns text content plus `structuredContent`; all 17 tools advertise an output schema.

| Result | `structuredContent` |
|--------|---------------------|
| Single JSON lookup | `{ "data": ... }` |
| Public egress IP | `{ "ip": "..." }` |
| Bulk lookup | `{ "items": [...], "errors": [...] }` |
| Oversized success | `{ "page": ... }` |
| Whole-call failure | `{ "error": ... }` with `isError: true` |

Normal text responses keep the API's JSON format, or a plain IP string for `get_my_ip`. Oversized successful responses contain a page in both text and structured content.

Authenticated upstream requests send the API key in the `x-ipgeolocation-api-key` header. The key is not added to request URLs.

Server instructions and tool descriptions explain selection, costs, limits, and interpretation to the MCP client. Clients decide how to expose this guidance to their assistant. Returned WHOIS text, user agents, hostnames, and error messages are untrusted data and must not override those instructions. An omitted IP selector refers to the server machine's public egress IP, which can differ from the end user's IP. Security tools query IP intelligence; they do not invoke the separate browser-based live VPN/proxy detection API.

`lookup_company`, `lookup_currency`, and `lookup_network` are wrappers around parts of the full IP lookup response. They exist as separate tools so MCP clients can discover them when a user only needs one piece of data.

## Caching

The server stores cached responses in process memory and shares identical requests already running for the same API key. Sessions using the same key share the cache namespace; different keys use separate namespaces.

| Cached data | Default expiry | Reads extend expiry? |
|-------------|----------------|----------------------|
| Normal tool response | 5 minutes after storage | No |
| Complete pagination snapshot | 5 minutes of idle time | Yes, after each successful `get_cached_result` read |

Both use `IPGEOLOCATION_MCP_CACHE_TTL_MS` (`300000` ms by default). The cache holds up to 500 entries by default, shared by normal responses and page snapshots. This limits entry count, not total bytes or memory. A complete snapshot can be much larger than an individual page.

Expiry, eviction, or process restart can make cached data unavailable. `get_cached_result` then fails locally without refetching. Repeating the original lookup after a cache miss can consume credits again.

`force_refresh: true` starts a new upstream request, even if an identical request is running. Older requests cannot overwrite its cached result.

**Cached:** `lookup_ip`, `bulk_lookup_ip`, `check_security`, `bulk_security_check`, `lookup_company`, `lookup_currency`, `lookup_network`, `parse_user_agent`, `bulk_parse_user_agent`, `lookup_asn`, `get_abuse_contact`, `get_astronomy_time_series`

**Always live (not cached):** `get_my_ip`, `get_timezone`, `convert_timezone`, `get_astronomy`

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `IPGEOLOCATION_API_KEY` | Yes (most tools) | | Your ipgeolocation.io API key |
| `IPGEOLOCATION_REQUEST_TIMEOUT_MS` | No | `15000` | Upstream deadline in ms, including response-body reading. Range: 1000-120000 |
| `IPGEOLOCATION_MCP_CACHE_TTL_MS` | No | `300000` | Normal-response TTL and page-snapshot idle TTL in ms. Range: 1000-3600000 |
| `IPGEOLOCATION_MCP_CACHE_MAX_ENTRIES` | No | `500` | Maximum cached responses and page snapshots; not a memory-byte limit. Range: 10-5000 |
| `IPGEOLOCATION_MCP_MAX_BULK_ITEMS` | No | `1000` | Bulk input ceiling, also capped by `IPGEOLOCATION_MCP_MAX_RESULT_ITEMS`. Max: 50000 |
| `IPGEOLOCATION_MCP_MAX_RESULT_ITEMS` | No | `250` | Bulk input/result item ceiling; nested arrays remain complete. Max: 50000 |
| `IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS` | No | `200000` | Maximum UTF-8 bytes of a complete serialized tool result, including text and structured content. Oversized successes use cached pages; oversized errors shorten messages. Range: 10000-2000000 |
| `IPGEOLOCATION_MCP_MAX_ERROR_CHARS` | No | `4000` | Upper limit on error-message characters before truncation markers. The complete response byte budget can shorten messages further. Range: 200-50000 |

Bulk batches above the effective item limit are rejected before an upstream request, without using API credits. Raising only `IPGEOLOCATION_MCP_MAX_BULK_ITEMS` does not raise the effective limit; raise both item settings if larger batches are needed.

The response limit includes both text and structured content, JSON escaping, and UTF-8 encoding. Successful results retain every record and nested array through cached pages when needed. Oversized errors shorten only their messages, preserving their category, retryability, guidance, and any status.

## Cached Result Pagination

`get_cached_result` costs **0 credits** and never calls the API, including when its cursor is invalid, expired, evicted, or unavailable after a server restart. It accepts one required `cursor`, returned in `page.cursor` or `page.next_cursor`. Use the same server process and API key.

A large original lookup returns `{ "page": ... }` instead of its normal `data` or `items`/`errors`. Each page contains:

| Field | Meaning |
|-------|---------|
| `source_tool` | Original lookup tool |
| `format` | `structuredContent_json` |
| `json_fragment` | Part of the complete original structured JSON result |
| `offset`, `total_chars` | Fragment position and full JSON length, in UTF-16 code units |
| `cursor` | Replay this page without repeating the lookup |
| `next_cursor` | Read the next page; absent on the final page |
| `expires_at` | Idle expiry timestamp; successful reads extend the TTL, five minutes by default |

Read each `next_cursor` with `get_cached_result`, concatenate the `json_fragment` strings in offset order, and parse the joined JSON once. A fragment is not necessarily valid JSON on its own. This also handles a single record or string larger than one page. Bulk results reconstruct the complete `{ "items": [...], "errors": [...] }`, preserving input identifiers and statuses. Single lookups reconstruct `{ "data": ... }`.

```javascript
let response = await client.callTool({ name: "bulk_lookup_ip", arguments: { ips } });
if (response.isError) throw new Error(response.content[0].text);
let complete = response.structuredContent;
if (complete.page) {
  let json = "";
  for (;;) {
    const page = response.structuredContent.page;
    json += page.json_fragment;
    if (!page.next_cursor) break;
    response = await client.callTool({
      name: "get_cached_result", arguments: { cursor: page.next_cursor }
    });
    if (response.isError) throw new Error(response.content[0].text);
  }
  complete = JSON.parse(json);
}
```

Use cursors to retrieve remaining data. The [cache rules](#caching) explain snapshot expiry, eviction, API-key isolation, and when a new lookup can consume credits.

## Building from Source

```bash
git clone https://github.com/IPGeolocation/ipgeolocation-io-mcp.git
cd ipgeolocation-io-mcp
npm ci --ignore-scripts
npm run build
```

Run it directly:

```bash
node dist/cli.js
```

Set `IPGEOLOCATION_API_KEY` through your shell's private environment settings before running the command. The process waits for MCP messages on stdin; it does not display an interactive prompt.

Inspect with MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/cli.js
```

## Docker

```bash
docker build -t ipgeolocation-mcp .
docker run --rm -i -e IPGEOLOCATION_API_KEY ipgeolocation-mcp
```

Set `IPGEOLOCATION_API_KEY` in your private shell environment first. The image includes Node.js and runs as the unprivileged `node` user. [Docker's `-i` flag](https://docs.docker.com/reference/cli/docker/container/run/#interactive) keeps stdin open for MCP messages. Omit `-t` so the protocol uses ordinary stdin/stdout.

The final image runs the compiled server directly. npm and Yarn are available in the build stage; the runtime image contains Node.js and the installed production dependencies.

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

Client setup examples document configuration formats. Record GUI and operating-system installation checks separately from protocol, package, and Docker tests; see the [release checklist](RELEASING.md).

```bash
npm test               # full suite
npm run test:unit      # unit tests only
npm run test:integration  # integration tests only
```

Live smoke tests use a real stdio MCP client and spend API credits. `IPGEOLOCATION_FREE_KEY` with `npm run test:live:free` checks the seven core tools, paid-feature restrictions, ownership/network fallbacks, and the observed bulk entitlement. It reports when bulk access differs from the documented paid-only policy. `IPGEOLOCATION_PAID_KEY` with `npm run test:live:paid` checks all 16 API tools, paid modules, structured validation errors, mixed valid/private bulk inputs, and the local cached-result reader. Testing a paid key does not verify free-plan entitlement restrictions.

After building, verify complete cached pagination with either key:

```bash
node tests/pagination.stdio.mjs free  # uses IPGEOLOCATION_FREE_KEY
node tests/pagination.stdio.mjs paid  # uses IPGEOLOCATION_PAID_KEY
```

Each run makes one six-IP API request and checks the reported six credits. It compares the recovered records against a hash of the complete upstream response and verifies that page reads, replay, expiry, and process restart make no additional API calls. The test temporarily lowers the child server's response budget and cache TTL; your server configuration stays unchanged.

To check the same behavior in the image built above:

```bash
node tests/pagination.stdio.mjs free docker run --rm -i \
  -e IPGEOLOCATION_API_KEY -e IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS \
  -e IPGEOLOCATION_MCP_CACHE_TTL_MS -e NODE_OPTIONS ipgeolocation-mcp
```

## Troubleshooting

**Client uses an old tool after updating:** Restart the server process and check its version in your client's MCP connection details. Compare it with the [latest npm version](https://www.npmjs.com/package/ipgeolocation-io-mcp). Rebuild source and Docker installations before restarting them.

**API key not configured:** Set `IPGEOLOCATION_API_KEY` in your client's server configuration. This local error has no HTTP status and makes no upstream request.

**401 errors:** The API rejected the key or requested capability. Check that the key is active and the plan supports the tool. Domain lookups in `lookup_ip` also require a paid plan.

**423 errors:** Use a public routable IP. Private/bogon addresses such as `10.0.0.1` and reserved documentation addresses such as `203.0.113.42` cannot be used as successful geolocation examples.

**Local 504 timeouts:** With `source: "mcp_server"`, the request or response-body read exceeded the deadline. Check the connection or increase `IPGEOLOCATION_REQUEST_TIMEOUT_MS` (default: 15000 ms, max: 120000 ms). With `source: "ipgeolocation_api"`, 504 is an HTTP response from the API.

**Redirect blocked:** The server received an unexpected HTTP redirect and stopped before forwarding credentials or request data. Do not retry automatically. Investigate the API endpoint or contact support with the sanitized error.

**Cached result unavailable:** The cursor belongs to another key or process, or the snapshot expired or was evicted. The failed page read made no API call. A new lookup can consume credits.

**Client asks for an MCP URL:** This package supplies a local `stdio` command. Use a client or host that can launch it; a remote-only connector needs a hosted MCP endpoint.

## Pricing

For current plan details, credits, and pricing, see the [IPGeolocation pricing page](https://ipgeolocation.io/pricing.html).

## Links

- [IPGeolocation Website](https://ipgeolocation.io)
- [IPGeolocation API Documentation](https://ipgeolocation.io/documentation.html)
- [IPGeolocation Pricing](https://ipgeolocation.io/pricing.html)
- [Create a Free IPGeolocation API Key](https://app.ipgeolocation.io/signup)
- [Changelog](CHANGELOG.md)
- [Security Policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Release Checklist](RELEASING.md)

## License

[MIT](LICENSE)

## Privacy Policy

API lookups send the requested inputs to IPGeolocation.io, which also receives the server machine's public egress IP. The server caches results in process memory. Your MCP client or hosting provider controls its own configuration and log storage. See the [Security Policy](SECURITY.md#lookup-data-and-caching) for retention details and the [IPGeolocation Privacy Policy](https://ipgeolocation.io/privacy.html) for provider handling.
