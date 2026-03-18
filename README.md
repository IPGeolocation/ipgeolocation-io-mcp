# IPGeolocation.io MCP Server

[![npm version](https://img.shields.io/npm/v/ipgeolocation-io-mcp?logo=npm&label=npm&color=CB3837)](https://www.npmjs.com/package/ipgeolocation-io-mcp)
[![GitHub release](https://img.shields.io/github/v/release/IPGeolocation/ipgeolocation-io-mcp?logo=github&label=release&color=181717)](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-live-0A7CFF?logo=modelcontextprotocol&logoColor=white)](https://registry.modelcontextprotocol.io/?q=ipgeolocation)
[![Glama](https://glama.ai/mcp/servers/IPGeolocation/ipgeolocation-io-mcp/badges/score.svg)](https://glama.ai/mcp/servers/IPGeolocation/ipgeolocation-io-mcp)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-5FA04E?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-16A34A)](https://github.com/IPGeolocation/ipgeolocation-io-mcp/blob/main/LICENSE)

Official MCP server for [IPGeolocation.io](https://ipgeolocation.io). Includes 16 MCP tools: IP geolocation, threat/VPN/proxy detection, timezone lookups and conversions, sunrise/sunset/moon data, ASN details, abuse contacts, and user-agent parsing. Seven tools work on the free plan (1,000 credits/day). Paid plans unlock all 16 plus bulk endpoints (up to 1,000 items per call).

Works with Claude Desktop, Cursor, Windsurf, VS Code, Codex, Cline, Glama, and any other MCP client.

| Item | Value |
|------|-------|
| Package | `ipgeolocation-io-mcp` |
| Version | `1.0.10` |
| Transport | `stdio` |
| Node.js | `>=18` |

## Quick Start

1. [Create a free IPGeolocation API key](https://app.ipgeolocation.io/signup)

2. Add this to your MCP client config (see [Install by Client](#install-by-client) below for the exact config file path for your client):

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

3. Restart your client.

4. Test it: ask **"Where is 8.8.8.8 located?"**

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

- Node.js 18 or later
- `npx` available in your terminal
- An IPGeolocation.io API key for most tools

`get_my_ip` works without an API key. Everything else requires one.

[Sign up for a free IPGeolocation API key](https://app.ipgeolocation.io/signup)

### Codex CLI

```bash
codex mcp add ipgeolocation --env IPGEOLOCATION_API_KEY=<YOUR_API_KEY> -- npx -y ipgeolocation-io-mcp
codex mcp list
```

Start a new Codex session after adding the server.

### Claude Desktop

Add to `claude_desktop_config.json`:

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

Restart Claude Desktop after saving. We also ship `manifest.json` for clients that support MCP Bundles.

### Cline

Open MCP Servers panel > **Configure** > **Advanced MCP Settings**. Add to `cline_mcp_settings.json`:

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

Restart Cline after saving.

### Cursor

Add to `.cursor/mcp.json`:

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

Restart Cursor after saving.

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

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

Restart Windsurf after saving.

### VS Code / GitHub Copilot

Add to your VS Code `settings.json`:

```json
{
  "mcp": {
    "servers": {
      "ipgeolocation": {
        "command": "npx",
        "args": ["-y", "ipgeolocation-io-mcp"],
        "env": {
          "IPGEOLOCATION_API_KEY": "<YOUR_API_KEY>"
        }
      }
    }
  }
}
```

Restart VS Code after saving.

### Glama

You can try the server on [Glama](https://glama.ai/mcp/servers/IPGeolocation/ipgeolocation-io-mcp) directly. Only `IPGEOLOCATION_API_KEY` is required. Leave other environment variable fields empty unless you want to change cache, timeout, or output limits.

If you don't have a key yet, [create a free IPGeolocation API key](https://app.ipgeolocation.io/signup).

### Any Other MCP Client

Use this config:

```json
{
  "command": "npx",
  "args": ["-y", "ipgeolocation-io-mcp"],
  "env": {
    "IPGEOLOCATION_API_KEY": "<YOUR_API_KEY>"
  }
}
```

## Verify It Works

Try these after setup:

| Prompt | Expected tool |
|--------|---------------|
| Where is 8.8.8.8 located? | `lookup_ip` |
| For IP 49.12.212.42, give me security verdict, company, ASN, and city. | `lookup_ip` with `fields` and `include=security` |
| Is 2.56.12.11 safe to allow and what is the abuse contact email? | `lookup_ip` with `include=security,abuse` |
| For AS1, list upstream ASN numbers only. | `lookup_asn` with `include=upstreams` |
| Convert 2026-03-07 09:30 from New York to Tokyo time. | `convert_timezone` |
| Give sunrise times for Karachi from 2026-03-10 to 2026-03-15. | `get_astronomy_time_series` |
| Parse this user agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 | `parse_user_agent` |

## Tools by Plan

### Free Plan

1,000 credits per day. These 7 tools are available:

| Tool | Credits | What it does |
|------|---------|--------------|
| `lookup_ip` | 1 | Location, timezone, currency, ASN for one IP |
| `get_my_ip` | 0 | Public IP of the machine running the server |
| `lookup_currency` | 1 | Currency and country metadata for one IP |
| `get_timezone` | 1 | Timezone by name, location, IP, airport code, or UN/LOCODE |
| `convert_timezone` | 1 | Convert time between two locations |
| `get_astronomy` | 1 | Sunrise, sunset, moonrise, moonset, twilight, moon phase for one date |
| `get_astronomy_time_series` | 1 | Daily astronomy data for a date range (up to 90 days) |

### Paid Plans

All 16 tools. Paid plans also add `network`, `company`, and extended `asn` fields to `lookup_ip`, plus the `include` parameter for `security`, `abuse`, `hostname`, `liveHostname`, `hostnameFallbackLive`, `user_agent`, `geo_accuracy`, `dma_code`, or `*`.

| Tool | Credits | What it does |
|------|---------|--------------|
| `bulk_lookup_ip` | 1 per IP | Batch geolocation for up to 1,000 IPs |
| `check_security` | 2 | VPN, proxy, Tor, bot, spam, and threat flags |
| `bulk_security_check` | 2 per IP | Batch threat checks |
| `lookup_company` | 1 | Company name and ASN holder for one IP |
| `lookup_network` | 1 | Route prefix, connection type, anycast status |
| `parse_user_agent` | 1 | Parse one UA string into browser, device, OS, engine |
| `bulk_parse_user_agent` | 1 per UA | Batch UA parsing for up to 1,000 strings |
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

### lookup_ip

Single IP or domain lookup. **Free and paid. 1 credit.**

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

### bulk_lookup_ip

Batch IP lookup. **Paid. 1 credit per IP.**

Takes an array of IPs or domains (up to 1,000 by default, configurable with `IPGEOLOCATION_MCP_MAX_BULK_ITEMS`). Supports the same `include`, `fields`, and `excludes` options as `lookup_ip`.

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

Threat and anonymity data for one IP. **Paid. 2 credits.**

Returns threat score, VPN/proxy/Tor flags, provider names, confidence scores, bot/spam indicators, anonymity flags, and cloud-provider status.

If the same prompt also asks for location, ASN, or abuse data, you're better off using `lookup_ip` with `include=security` because it bundles everything in one call (3 credits total instead of 2 + 1 separately).

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ip` | No | IP address to check |
| `fields` | No | Comma-separated fields to return |
| `excludes` | No | Comma-separated fields to exclude |
| `force_refresh` | No | Skip the cache |

### bulk_security_check

Batch version of `check_security`. **Paid. 2 credits per IP.**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ips` | Yes | Array of IP addresses |
| `fields` | No | Comma-separated fields to return per IP |
| `excludes` | No | Comma-separated fields to exclude per IP |
| `force_refresh` | No | Skip the cache |

### get_timezone

Current time and timezone details for a location. **Free and paid. 1 credit.**

Accepts IANA timezone names, coordinates, IP addresses, airport codes (IATA/ICAO), or UN/LOCODEs. The response includes timezone offsets, date/datetime variants, `current_time`, `current_time_unix`, `time_24`, `time_12`, `week`, `month`, `year`, timezone abbreviations, and DST transition details.

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

Takes the same location input types as `get_timezone` for both source and destination. If you leave out the `time` parameter, it converts the current time. Always hits the network (not cached).

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

Sun and moon data for one location on one date. **Free and paid. 1 credit.**

Returns sunrise, sunset, moonrise, moonset, morning and evening twilight, solar noon, day length, moon phase, sun/moon status flags, and live sun/moon position (altitude, azimuth).

Always hits the network (not cached) because skipping `date` defaults to today.

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

Parses one UA string into browser, device, OS, and engine data. **Paid. 1 credit.**

Also classifies bots and crawlers. Note: this parses the `uaString` you pass in. It does not infer a caller UA from the MCP connection itself.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `uaString` | Yes | The user-agent string to parse |
| `force_refresh` | No | Skip the cache |

Returns `name`, `type`, `version`, `device`, `engine`, and `operating_system`.

### bulk_parse_user_agent

Batch version of `parse_user_agent`. **Paid. 1 credit per string.**

Takes up to 1,000 strings per request by default (configurable with `IPGEOLOCATION_MCP_MAX_BULK_ITEMS`).

| Parameter | Required | Description |
|-----------|----------|-------------|
| `uaStrings` | Yes | Array of user-agent strings |
| `force_refresh` | No | Skip the cache |

### lookup_company

Returns just the company name and ASN holder for one IP. **Paid. 1 credit.**

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

Returns a `network` object with `connection_type`, `route`, and `is_anycast`.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ip` | No | IP address |
| `force_refresh` | No | Skip the cache |

### lookup_asn

Full ASN lookup. **Paid. 1 credit.**

`lookup_ip` also returns an `asn` object, but only with basic metadata. This tool returns the full ASN record, including peers, upstreams, downstreams, routes, and WHOIS. Call it once with the `include` fields you need, then filter locally instead of making multiple calls for different slices.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `asn` | No | ASN (e.g., `AS13335` or `13335`) |
| `ip` | No | IP address to resolve to an ASN |
| `include` | No | `peers`, `downstreams`, `upstreams`, `routes`, `whois_response` |
| `fields` | No | Comma-separated fields to return |
| `excludes` | No | Comma-separated fields to exclude |
| `force_refresh` | No | Skip the cache |

### get_abuse_contact

Abuse contact details for one IP. **Paid. 1 credit.**

Returns the abuse route, country, contact name, organization, address, email addresses, and phone numbers. If you also need geolocation or security data for the same IP, use `lookup_ip` with `include=abuse` (or `include=security,abuse`) to get everything in one call.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ip` | No | IP address |
| `fields` | No | Comma-separated fields to return |
| `excludes` | No | Comma-separated fields to exclude |
| `force_refresh` | No | Skip the cache |

## Prompt Examples

### Check if an IP is safe

- Is 49.12.212.42 safe to trust in our network? Give me the threat summary and city.
- Check these IPs for VPN, proxy, Tor, bot, and spam indicators: 49.12.212.42, 2.56.12.11, 8.8.8.8
- For 203.0.113.42, tell me the threat score, whether it is a cloud provider, and whether it looks like a relay.

### Find who owns an IP

- Who uses 1.1.1.1 and which ASN routes it?
- For AS24940, list upstream ASN numbers only.
- Is this IP anycast and what route prefix is announced for it: 1.1.1.1

### Get abuse contacts

- For IP 2.56.12.11, give me the abuse contact email, phone number, and organization.
- I need the abuse contact for 1.0.0.0 and the network route involved.
- For this IP, show me the abuse contact details only: 198.51.100.27

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

The text answers below show what a client might say. Exact wording depends on the model. The JSON blocks show raw tool output, trimmed for readability.

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

All tools return structured errors instead of crashing the server.

| Code | Meaning |
|------|---------|
| `400` | Bad parameters, invalid date/time format, missing coordinate pair, or unsupported input |
| `401` | Missing/invalid API key, free plan calling a paid tool, or non-English `lang` on free plan |
| `404` | Resource not found (e.g., ASN does not exist) |
| `405` | Method or subscription restriction from the upstream API |
| `423` | Bogon or private IP (`10.x.x.x`, `192.168.x.x`, etc.) |
| `429` | Rate limit, daily credit limit, or account quota exceeded |
| `499` | Upstream validation error or unsupported query |
| `502` | Server could not reach the upstream API |
| `504` | Upstream API timed out |

Exact status codes can vary by endpoint and request mode. If an upstream endpoint returns a different error, the server passes it through with a structured message.

## How It Works

This is a stdio MCP server that wraps the ipgeolocation.io v3 APIs.

At runtime:

1. Your MCP client starts the server process.
2. The client reads the tool list.
3. When a prompt matches a tool, the client calls it.
4. The server validates inputs, calls our API, and returns structured JSON.
5. Cacheable responses are stored in process memory so repeated identical requests skip the API call.

`lookup_company`, `lookup_currency`, and `lookup_network` are wrappers around parts of the full IP lookup response. They exist as separate tools so MCP clients can discover them when a user only needs one piece of data.

## Caching

Tools that return stable data (not current-time lookups) cache their responses in process memory. Repeated lookups are faster and don't use additional credits. Client retries don't generate duplicate API calls.

- Process-level cache, not client or model memory
- Default TTL: 5 minutes (`300000` ms)
- Cache resets when the server process stops
- Cache misses on TTL expiry, changed parameters, or `force_refresh: true`

**Cached:** `lookup_ip`, `bulk_lookup_ip`, `check_security`, `bulk_security_check`, `lookup_company`, `lookup_currency`, `lookup_network`, `parse_user_agent`, `bulk_parse_user_agent`, `lookup_asn`, `get_abuse_contact`, `get_astronomy_time_series`

**Always live (not cached):** `get_my_ip`, `get_timezone`, `convert_timezone`, `get_astronomy`

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `IPGEOLOCATION_API_KEY` | Yes (most tools) | | Your ipgeolocation.io API key |
| `IPGEOLOCATION_REQUEST_TIMEOUT_MS` | No | `15000` | Upstream timeout in ms. Range: 1000-120000 |
| `IPGEOLOCATION_MCP_CACHE_TTL_MS` | No | `300000` | Cache TTL in ms. Range: 1000-3600000 |
| `IPGEOLOCATION_MCP_CACHE_MAX_ENTRIES` | No | `500` | Max entries before eviction. Range: 10-5000 |
| `IPGEOLOCATION_MCP_MAX_BULK_ITEMS` | No | `1000` | Max items per bulk request. Max: 50000 |
| `IPGEOLOCATION_MCP_MAX_RESULT_ITEMS` | No | `250` | Max array items before truncation |
| `IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS` | No | `200000` | Max response text length |
| `IPGEOLOCATION_MCP_MAX_ERROR_CHARS` | No | `4000` | Max error text length |

## Building from Source

```bash
git clone https://github.com/IPGeolocation/ipgeolocation-io-mcp.git
cd ipgeolocation-io-mcp
npm install
npm run build
```

Run it directly:

```bash
IPGEOLOCATION_API_KEY=<YOUR_KEY> node dist/index.js
```

Inspect with MCP Inspector:

```bash
IPGEOLOCATION_API_KEY=<YOUR_KEY> npx @modelcontextprotocol/inspector node dist/index.js
```

## Docker

```bash
docker build -t ipgeolocation-mcp .
docker run -e IPGEOLOCATION_API_KEY=<YOUR_KEY> ipgeolocation-mcp
```

## Testing

```bash
npm test               # full suite
npm run test:unit      # unit tests only
npm run test:integration  # integration tests only
```

## Troubleshooting

**Client uses an old tool after updating:** Restart the client and confirm it loaded the latest npm version.

**401 errors:** Check that `IPGEOLOCATION_API_KEY` is set in your config. Some tools are paid-only and return 401 on the free plan. Domain lookups in `lookup_ip` also require a paid plan.

**423 errors:** You passed a private/bogon IP like `10.0.0.1` or `192.168.1.1`. These have no geolocation data.

**504 timeouts:** The upstream API did not respond in time. Increase the timeout with `IPGEOLOCATION_REQUEST_TIMEOUT_MS` (default: 15000 ms, max: 120000 ms).

## Pricing

For current plan details, credits, and pricing, see the [IPGeolocation pricing page](https://ipgeolocation.io/pricing.html).

## Links

- [IPGeolocation Website](https://ipgeolocation.io)
- [IPGeolocation API Documentation](https://ipgeolocation.io/documentation.html)
- [IPGeolocation Pricing](https://ipgeolocation.io/pricing.html)
- [Create a Free IPGeolocation API Key](https://app.ipgeolocation.io/signup)
- [Changelog](CHANGELOG.md)

## License

[MIT](LICENSE)

## Privacy Policy

Read the [IPGeolocation Privacy Policy](https://ipgeolocation.io/privacy.html).
