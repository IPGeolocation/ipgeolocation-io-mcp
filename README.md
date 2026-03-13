# IPGeolocation.io MCP Server

Official MCP server for IP geolocation, IP security, abuse contacts, ASN, timezone, astronomy, and user-agent parsing.

We build and maintain this server so you can use our APIs from Codex, Claude Desktop, Cursor, Windsurf, VS Code, and other MCP-compatible clients.

| Item | Value |
|------|-------|
| Package | `ipgeolocation-io-mcp` |
| Version | `1.0.9` |
| Transport | `stdio` |
| Node.js | `>=18` |
| Free plan support | 7 tools, 1,000 credits per day |
| Paid plan support | All 16 tools, advanced IP intelligence, bulk operations |
| Bundle manifest | `manifest.json` included |

## Table of Contents

- [What We Provide](#what-we-provide)
- [Install](#install)
- [Verify It Works](#verify-it-works)
- [Prompt Examples by Use Case](#prompt-examples-by-use-case)
- [Example Answers and Tool Output](#example-answers-and-tool-output)
- [Tools by Plan](#tools-by-plan)
- [Tool Details](#tool-details)
- [Credit Costs](#credit-costs)
- [Error Handling](#error-handling)
- [Pricing](#pricing)
- [Building from Source](#building-from-source)
- [Testing](#testing)
- [How It Works](#how-it-works)
- [Caching and Refresh](#caching-and-refresh)
- [Environment Variables](#environment-variables)
- [License](#license)
- [Privacy Policy](#privacy-policy)
- [Links](#links)

## What We Provide

We expose 16 MCP tools across our IP intelligence and location APIs.

What you get:

- Official server maintained by the ipgeolocation.io team
- One MCP package for IP lookup, security checks, timezone, astronomy, ASN, abuse contacts, and user-agent parsing
- Free-plan coverage for core location, timezone, and astronomy workflows
- Bulk tools for IP lookup, security checks, and user-agent parsing
- Tool descriptions written to help clients choose lower-cost and lower-latency request paths
- Server-side caching for deterministic lookups so repeated requests for the same input do not keep hitting upstream APIs
- `manifest.json` included for clients that support MCP Bundles

## Install

### Requirements

- Node.js `18` or later
- An ipgeolocation.io API key for most tools
- `npx` available in your environment

`get_my_ip` works without an API key. All other tools require one.

[Sign up for a free IPGeolocation API key](https://app.ipgeolocation.io/signup)

### Install by Client

#### Codex CLI

```bash
codex mcp add ipgeolocation --env IPGEOLOCATION_API_KEY=<IPGEOLOCATION_API_KEY> -- npx -y ipgeolocation-io-mcp
codex mcp list
```

Start a new Codex session after adding the server.

#### Claude Desktop

We ship `manifest.json` for clients that support MCP Bundles. If you want to configure Claude Desktop manually, add this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ipgeolocation": {
      "command": "npx",
      "args": ["-y", "ipgeolocation-io-mcp"],
      "env": {
        "IPGEOLOCATION_API_KEY": "<IPGEOLOCATION_API_KEY>"
      }
    }
  }
}
```

Restart Claude Desktop after saving the config.

#### Cline

Open the MCP Servers panel in Cline, go to **Configure**, then open **Advanced MCP Settings**. Add this to `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "ipgeolocation": {
      "command": "npx",
      "args": ["-y", "ipgeolocation-io-mcp"],
      "env": {
        "IPGEOLOCATION_API_KEY": "<IPGEOLOCATION_API_KEY>"
      }
    }
  }
}
```

Restart Cline after saving the config.

#### Cursor

Add this to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "ipgeolocation": {
      "command": "npx",
      "args": ["-y", "ipgeolocation-io-mcp"],
      "env": {
        "IPGEOLOCATION_API_KEY": "<IPGEOLOCATION_API_KEY>"
      }
    }
  }
}
```

Restart Cursor after saving the config.

#### Windsurf

Add this to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "ipgeolocation": {
      "command": "npx",
      "args": ["-y", "ipgeolocation-io-mcp"],
      "env": {
        "IPGEOLOCATION_API_KEY": "<IPGEOLOCATION_API_KEY>"
      }
    }
  }
}
```

Restart Windsurf after saving the config.

#### VS Code / GitHub Copilot

Add this to your VS Code `settings.json`:

```json
{
  "mcp": {
    "servers": {
      "ipgeolocation": {
        "command": "npx",
        "args": ["-y", "ipgeolocation-io-mcp"],
        "env": {
          "IPGEOLOCATION_API_KEY": "<IPGEOLOCATION_API_KEY>"
        }
      }
    }
  }
}
```

Restart VS Code after saving the config.

#### Any Other MCP Client

Use the same process configuration:

```json
{
  "command": "npx",
  "args": ["-y", "ipgeolocation-io-mcp"],
  "env": {
    "IPGEOLOCATION_API_KEY": "<IPGEOLOCATION_API_KEY>"
  }
}
```

## Verify It Works

Use these prompts after installation. They are short, easy to validate, and cover the main tool categories.

| Prompt | Preferred tool path |
|------|------|
| Where is 8.8.8.8 located? | `lookup_ip` |
| For IP 49.12.212.42, give me security verdict, company, ASN, and city. | `lookup_ip` with targeted `fields` and `include=security` |
| Is 2.56.12.11 safe to allow and what is the abuse contact email? | `lookup_ip` with targeted `fields` and `include=security,abuse`, or a minimal equivalent path |
| For AS1, list upstream ASN numbers only. | `lookup_asn` once with `include=upstreams`, then local filtering |
| Convert 2026-03-07 09:30 from New York to Tokyo time. | `convert_timezone` |
| Give sunrise times for Karachi from 2026-03-10 to 2026-03-15. | `get_astronomy_time_series` |
| Parse this user agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 | `parse_user_agent` |

If your client keeps using an older tool path after an update, restart the client and make sure it is loading version `1.0.9`.

## Prompt Examples by Use Case

### IP reputation and access decisions

- Is 49.12.212.42 safe to trust in our network? Give me the threat summary and city.
- Check these IPs for VPN, proxy, Tor, bot, and spam indicators: 49.12.212.42, 2.56.12.11, 8.8.8.8
- For 203.0.113.42, tell me the threat score, whether it is a cloud provider, and whether it looks like a relay.

### Ownership, ASN, and routing

- Who uses 1.1.1.1 and which ASN routes it?
- For AS24940, list upstream ASN numbers only.
- Is this IP anycast and what route prefix is announced for it: 1.1.1.1

### Abuse and incident response

- For IP 2.56.12.11, give me the abuse contact email, phone number, and organization.
- I need the abuse contact for 1.0.0.0 and the network route involved.
- For this IP, show me the abuse contact details only: 198.51.100.27

### Time and timezone workflows

- What time is it in Tokyo right now?
- Convert 2026-03-07 09:30 from New York to Tokyo time.
- What is the current local time at JFK airport?

### Astronomy and daylight planning

- Give sunrise and sunset for London on 2026-06-21.
- Show sunrise times in Karachi from 2026-03-10 to 2026-03-15.
- For New York, give me moon phase and day length on 2026-07-17.

### User-agent analysis

- Parse this user agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_2) AppleWebKit/601.3.9 (KHTML, like Gecko) Version/9.0.2 Safari/601.3.9
- Parse these user agents in bulk and tell me the browser, OS, and device type for each.
- Does this user agent look like a crawler or bot? Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/41.0.2272.96 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)

## Example Answers and Tool Output

Actual assistant wording varies by client and model. The natural-language snippets below show a typical answer. The JSON blocks show trimmed tool output returned by our MCP server.

<details>
<summary><strong>Example 1: Single IP lookup</strong></summary>

**Prompt**

Locate 91.128.103.196 and give me the country, city, ASN, and local time.

**Typical assistant answer**

91.128.103.196 resolves to Stockholm, Sweden. The ASN is AS1257, operated by Tele2 Sverige AB. The local timezone is Europe/Stockholm, and the local time in this sample is 2026-02-12 18:36:54.401+0100.

**Example tool output**

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

</details>

<details>
<summary><strong>Example 2: Time conversion</strong></summary>

**Prompt**

Convert 2025-01-21 13:42:52 from DXB to LHR.

**Typical assistant answer**

2025-01-21 13:42:52 in Dubai converts to 2025-01-21 09:42:52 in London in this sample. The difference is 4 hours.

**Example tool output**

```json
{
  "original_time": "2025-01-21 13:42:52",
  "converted_time": "2025-01-21 09:42:52",
  "diff_hour": 4,
  "diff_min": 240
}
```

</details>

<details>
<summary><strong>Example 3: Company and ASN holder</strong></summary>

**Prompt**

Who uses 1.1.1.1 and which ASN routes it?

**Typical assistant answer**

1.1.1.1 is used by APNIC Research and Development, while the ASN routing it is AS13335, operated by Cloudflare, Inc.

**Example tool output**

```json
{
  "company": {
    "name": "APNIC Research and Development",
    "domain": "apnic.net"
  },
  "asn": {
    "as_number": "AS13335",
    "organization": "Cloudflare, Inc.",
    "country": "US"
  }
}
```

</details>

<details>
<summary><strong>Example 4: Astronomy time series</strong></summary>

**Prompt**

Show sunrise and sunset for New York from 2025-06-16 to 2025-06-18.

**Typical assistant answer**

For this New York date range, sunrise is about 05:23 and sunset about 20:30 each day. Day length is about 15 hours, and the moon phase changes from waning gibbous to last quarter in this sample.

**Example tool output**

```json
{
  "location": {
    "country_name": "United States",
    "state_prov": "New York",
    "city": "New York",
    "latitude": "40.76473",
    "longitude": "-74.00084"
  },
  "astronomy": [
    {
      "date": "2025-06-16",
      "sunrise": "05:23",
      "sunset": "20:30",
      "day_length": "15:06",
      "moon_phase": "WANING_GIBBOUS"
    },
    {
      "date": "2025-06-17",
      "sunrise": "05:23",
      "sunset": "20:30",
      "day_length": "15:06",
      "moon_phase": "LAST_QUARTER"
    }
  ]
}
```

</details>

<details>
<summary><strong>Example 5: User-agent parsing</strong></summary>

**Prompt**

Parse this user agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_2) AppleWebKit/601.3.9 (KHTML, like Gecko) Version/9.0.2 Safari/601.3.9

**Typical assistant answer**

This user agent is Safari 9.0.2 on Mac OS 10.11.2, running on an Apple Macintosh desktop with an Intel CPU.

**Example tool output**

```json
{
  "user_agent_string": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_2) AppleWebKit/601.3.9 (KHTML, like Gecko) Version/9.0.2 Safari/601.3.9",
  "name": "Safari",
  "type": "Browser",
  "version": "9.0.2",
  "device": {
    "name": "Apple Macintosh",
    "type": "Desktop",
    "brand": "Apple",
    "cpu": "Intel"
  },
  "operating_system": {
    "name": "Mac OS",
    "type": "Desktop",
    "version": "10.11.2"
  }
}
```

</details>

<details>
<summary><strong>Example 6: Abuse contact</strong></summary>

**Prompt**

Give me the abuse contact for 1.0.0.0.

**Typical assistant answer**

For 1.0.0.0, the abuse contact in this sample is IRT-APNICRANDNET-AU in Australia, covering route 1.0.0.0/24, with email helpdesk@apnic.net.

**Example tool output**

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

</details>

## Tools by Plan

### Free Plan

The free plan includes 1,000 credits per day and supports these tools:

| Tool | Credits | What it covers |
|------|---------|----------------|
| `lookup_ip` | 1 | IP geolocation, country metadata, currency, timezone, basic ASN |
| `get_my_ip` | 0 | Public IP of the machine running the MCP server |
| `lookup_currency` | 1 | Currency and country metadata for any IP |
| `get_timezone` | 1 | Timezone lookup by name, location, IP, airport code, or UN/LOCODE |
| `convert_timezone` | 1 | Time conversion between two locations |
| `get_astronomy` | 1 | Sunrise, sunset, moonrise, moonset, twilight, and moon phase |
| `get_astronomy_time_series` | 1 | Daily astronomy data for a date range up to 90 days |

### Paid Plans

Paid plans unlock all tools and additional fields on `lookup_ip`.

| Tool | Credits | What it covers |
|------|---------|----------------|
| `bulk_lookup_ip` | 1 per IP | Bulk geolocation for up to 1,000 items per MCP request by default |
| `check_security` | 2 | VPN, proxy, Tor, bot, and threat intelligence |
| `bulk_security_check` | 2 per IP | Bulk threat and anonymity checks |
| `lookup_company` | 1 | Company using an IP and the ASN holder |
| `lookup_network` | 1 | Route prefix, connection type, and anycast detection |
| `parse_user_agent` | 1 | Parse one user-agent string |
| `bulk_parse_user_agent` | 1 per UA | Parse up to 1,000 user-agent strings per MCP request by default |
| `lookup_asn` | 1 | ASN details, peers, upstreams, downstreams, routes, WHOIS |
| `get_abuse_contact` | 1 | Abuse contact emails, phone numbers, address, and route |

Paid plans also add `network`, `company`, and extended `asn` fields to `lookup_ip`, plus the `include` parameter for `security`, `abuse`, `hostname`, `liveHostname`, `hostnameFallbackLive`, `user_agent`, `geo_accuracy`, `dma_code`, or `*`.

## Tool Details

<details>
<summary><strong>lookup_ip</strong></summary>

Single IP or domain lookup.

Plan: free and paid  
Credits: 1 base credit

Choose this when:
- You need geolocation, timezone, currency, or ASN for one IP
- You need both base IP data and extra modules such as `security` or `abuse`
- You want one request instead of multiple single-purpose calls

Free plan returns base location, country metadata, currency, timezone, and basic ASN.

Paid plans add `network`, `company`, and extended ASN fields. Paid plans also support `include` modules.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ip` | No | IPv4, IPv6, or domain. Domain lookup requires a paid plan |
| `lang` | No | Response language. Non-English values require a paid plan |
| `include` | No | Extra modules: `security`, `abuse`, `hostname`, `liveHostname`, `hostnameFallbackLive`, `user_agent`, `geo_accuracy`, `dma_code`, or `*` |
| `fields` | No | Comma-separated fields to return |
| `excludes` | No | Comma-separated fields to exclude |
| `force_refresh` | No | Bypass the MCP cache and force a fresh upstream request |

</details>

<details>
<summary><strong>bulk_lookup_ip</strong></summary>

Bulk IP lookup for multiple addresses or domains.

Plan: paid only  
Credits: 1 per IP

Choose this when:
- You need geolocation or IP intelligence for more than one IP
- You want one request for a batch instead of many single lookups

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ips` | Yes | Array of IP addresses or domains |
| `lang` | No | Response language |
| `include` | No | Extra modules per IP |
| `fields` | No | Comma-separated fields to return per IP |
| `excludes` | No | Comma-separated fields to exclude per IP |
| `force_refresh` | No | Bypass the MCP cache and force a fresh upstream request |

The default cap is 1,000 items per MCP request. You can change it with `IPGEOLOCATION_MCP_MAX_BULK_ITEMS`.

</details>

<details>
<summary><strong>get_my_ip</strong></summary>

Return the public IP address of the machine running this MCP server.

Plan: free and paid  
Credits: 0

Choose this when:
- You need the caller IP only
- You want a no-auth health check for the server connection

Parameters: none

This tool always goes upstream and is not cached.

</details>

<details>
<summary><strong>check_security</strong></summary>

Threat and anonymity lookup for a single IP.

Plan: paid only  
Credits: 2

Choose this when:
- You only need security data for one IP
- You do not need company, ASN, location, or abuse data in the same response

If the same prompt also needs ownership, city, timezone, network, or abuse details, prefer `lookup_ip` with targeted `include`, `fields`, and `excludes`.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ip` | No | IP address to check |
| `fields` | No | Comma-separated fields to return |
| `excludes` | No | Comma-separated fields to exclude |
| `force_refresh` | No | Bypass the MCP cache and force a fresh upstream request |

Returns threat score, VPN/proxy/Tor flags, provider names, confidence scores, bot/spam indicators, anonymity flags, and cloud-provider status.

</details>

<details>
<summary><strong>bulk_security_check</strong></summary>

Threat and anonymity lookup for multiple IPs.

Plan: paid only  
Credits: 2 per IP

Choose this when:
- You need security-only checks for more than one IP
- You are triaging or screening a list of IPs

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ips` | Yes | Array of IP addresses |
| `fields` | No | Comma-separated fields to return per IP |
| `excludes` | No | Comma-separated fields to exclude per IP |
| `force_refresh` | No | Bypass the MCP cache and force a fresh upstream request |

</details>

<details>
<summary><strong>get_timezone</strong></summary>

Current time and timezone details for a location.

Plan: free and paid  
Credits: 1

Choose this when:
- You need the current local time and timezone details for one location
- You want timezone data by IANA name, coordinates, IP, airport code, or UN/LOCODE

Returns an object with `location` and `time_zone`. The `time_zone` object includes timezone offsets, date/date_time variants, `current_time`, `current_time_unix`, `time_24`, `time_12`, `week`, `month`, `year`, timezone abbreviations, and DST transition details.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `tz` | No | IANA timezone name, such as `America/New_York` |
| `lat` + `long` | No | Latitude and longitude |
| `location` | No | City or address string |
| `ip` | No | IP address |
| `iata_code` | No | IATA airport code |
| `icao_code` | No | ICAO airport code |
| `lo_code` | No | UN/LOCODE |
| `lang` | No | Response language for IP-based lookups. Non-English values require a paid plan |

This tool always goes upstream and is not cached because it returns current time.

</details>

<details>
<summary><strong>convert_timezone</strong></summary>

Convert a time from one location to another.

Plan: free and paid  
Credits: 1

Choose this when:
- You need a converted time between two timezones, locations, coordinates, or airports
- You want a direct time difference instead of two separate timezone lookups

| Parameter | Required | Description |
|-----------|----------|-------------|
| `time` | No | Time to convert in `yyyy-MM-dd HH:mm` or `yyyy-MM-dd HH:mm:ss` format. If omitted, we convert the current time |
| `tz_from` / `tz_to` | No | IANA timezone names |
| `lat_from` + `long_from` | No | Source coordinates |
| `lat_to` + `long_to` | No | Destination coordinates |
| `location_from` / `location_to` | No | Source and destination location strings |
| `iata_from` / `iata_to` | No | Source and destination IATA airport codes |
| `icao_from` / `icao_to` | No | Source and destination ICAO airport codes |
| `locode_from` / `locode_to` | No | Source and destination UN/LOCODEs |

This tool always goes upstream and is not cached because it can default to the current time.

</details>

<details>
<summary><strong>get_astronomy</strong></summary>

Sun and moon data for one location on one date.

Plan: free and paid  
Credits: 1

Choose this when:
- You need sunrise, sunset, moonrise, moonset, or day length for one date
- You need current positional data such as sun altitude or moon azimuth

Returns an object with `location` and `astronomy`. The `astronomy` object includes `morning` and `evening` twilight blocks, sunrise/sunset, solar noon, day length, moonrise/moonset, status fields, and the live sun/moon position fields for that date and location.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `lat` + `long` | No | Latitude and longitude. Highest priority when provided |
| `location` | No | City or address |
| `ip` | No | IP address |
| `date` | No | Date in `YYYY-MM-DD` format. Defaults to today |
| `elevation` | No | Elevation in meters. Allowed range is `0` to `10000` |
| `time_zone` | No | IANA timezone name to control time output |
| `lang` | No | Response language for IP-based lookups. Non-English values require a paid plan |

This tool always goes upstream and is not cached because omitting `date` returns time-sensitive data.

</details>

<details>
<summary><strong>get_astronomy_time_series</strong></summary>

Astronomy data for a date range.

Plan: free and paid  
Credits: 1 per request

Choose this when:
- You need multiple days of astronomy data in one request
- You want sunrise, sunset, day length, and moon phase across a range of dates

Returns an object with `location` and an `astronomy` array. Each daily entry includes `mid_night`, `night_end`, `morning`, `sunrise`, `sunset`, `evening`, `night_begin`, `sun_status`, `solar_noon`, `day_length`, `moon_phase`, `moonrise`, `moonset`, and `moon_status`.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `dateStart` | Yes | Start date in `YYYY-MM-DD` format |
| `dateEnd` | Yes | End date in `YYYY-MM-DD` format. Maximum span is 90 days |
| `lat` + `long` | No | Latitude and longitude. Highest priority when provided |
| `location` | No | City or address |
| `ip` | No | IP address |
| `elevation` | No | Elevation in meters |
| `time_zone` | No | IANA timezone name to control time output |
| `lang` | No | Response language for IP-based lookups. Non-English values require a paid plan |
| `force_refresh` | No | Bypass the MCP cache and force a fresh upstream request |

</details>

<details>
<summary><strong>parse_user_agent</strong></summary>

Parse one user-agent string.

Plan: paid only  
Credits: 1

Choose this when:
- You need structured browser, device, engine, and operating-system data for one user-agent string
- You need to classify crawlers, bots, or malformed user agents

This MCP tool parses the explicit `uaString` value you provide. It does not infer a caller user-agent from the MCP connection.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `uaString` | Yes | The user-agent string to parse |
| `force_refresh` | No | Bypass the MCP cache and force a fresh upstream request |

Returns `name`, `type`, `version`, `device`, `engine`, and `operating_system`.

</details>

<details>
<summary><strong>bulk_parse_user_agent</strong></summary>

Parse multiple user-agent strings in one request.

Plan: paid only  
Credits: 1 per user-agent string

Choose this when:
- You need structured parsing for more than one user-agent string
- You are processing log samples or traffic batches

This MCP tool parses only the explicit `uaStrings` values you provide.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `uaStrings` | Yes | Array of user-agent strings |
| `force_refresh` | No | Bypass the MCP cache and force a fresh upstream request |

The default cap is 1,000 items per MCP request. You can change it with `IPGEOLOCATION_MCP_MAX_BULK_ITEMS`.

</details>

<details>
<summary><strong>lookup_company</strong></summary>

Company and ASN holder lookup for one IP.

Plan: paid only  
Credits: 1

Choose this when:
- You only need the company using an IP and the ASN holder
- You want a small response instead of full geolocation data

If the same prompt also needs security, abuse, city, timezone, or network details, prefer `lookup_ip` with targeted `fields` and `include` modules.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ip` | No | IP address to look up |
| `force_refresh` | No | Bypass the MCP cache and force a fresh upstream request |

Returns `company` and `asn` objects.

</details>

<details>
<summary><strong>lookup_currency</strong></summary>

Currency and country metadata for one IP.

Plan: free and paid  
Credits: 1

Choose this when:
- You only need currency, country calling code, TLD, or languages for one IP
- You want a smaller response than full `lookup_ip`

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ip` | No | IP address to look up |
| `force_refresh` | No | Bypass the MCP cache and force a fresh upstream request |

Returns `currency` and `country_metadata`.

</details>

<details>
<summary><strong>lookup_network</strong></summary>

Route and network details for one IP.

Plan: paid only  
Credits: 1

Choose this when:
- You only need route prefix, connection type, or anycast status
- You want a smaller response than full `lookup_ip`

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ip` | No | IP address to look up |
| `force_refresh` | No | Bypass the MCP cache and force a fresh upstream request |

Returns a `network` object with `connection_type`, `route`, and `is_anycast`.

</details>

<details>
<summary><strong>lookup_asn</strong></summary>

Detailed ASN lookup.

Plan: paid only  
Credits: 1

Choose this when:
- You need ASN metadata beyond the basic ASN object returned by `lookup_ip`
- You need peers, upstreams, downstreams, routes, or WHOIS data

Call this once with the include set you need, then filter locally from the response instead of making repeat calls to reshape the same data.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `asn` | No | ASN such as `AS13335` or `13335` |
| `ip` | No | IP address to resolve to an ASN |
| `include` | No | Extra data: `peers`, `downstreams`, `upstreams`, `routes`, `whois_response` |
| `fields` | No | Comma-separated fields to return |
| `excludes` | No | Comma-separated fields to exclude |
| `force_refresh` | No | Bypass the MCP cache and force a fresh upstream request |

</details>

<details>
<summary><strong>get_abuse_contact</strong></summary>

Abuse contact lookup for one IP.

Plan: paid only  
Credits: 1

Choose this when:
- You only need abuse contact details for one IP
- You want the smallest and lowest-cost abuse-only path

If the same prompt also needs geolocation or security data, prefer `lookup_ip` with targeted `fields` and `include=abuse` or `include=security,abuse`.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ip` | No | IP address to look up |
| `fields` | No | Comma-separated fields to return |
| `excludes` | No | Comma-separated fields to exclude |
| `force_refresh` | No | Bypass the MCP cache and force a fresh upstream request |

Returns the abuse route, country, name, organization, address, emails, and phone numbers.

</details>

## Credit Costs

Each upstream API request uses credits from your ipgeolocation.io account.

| Action | Credits | Free Plan |
|--------|---------|-----------|
| `lookup_ip` base lookup | 1 | Yes |
| `lookup_ip` with `include=security` | 3 total | No |
| `lookup_ip` with `include=abuse` | 2 total | No |
| `lookup_ip` with `include=*` | 4 total | No |
| `lookup_ip` with `include=security&fields=security` | 2 total | No |
| `lookup_ip` with `include=abuse&fields=abuse` | 1 total | No |
| `bulk_lookup_ip` | 1 per IP | No |
| `check_security` | 2 | No |
| `bulk_security_check` | 2 per IP | No |
| `get_timezone` | 1 | Yes |
| `convert_timezone` | 1 | Yes |
| `get_astronomy` | 1 | Yes |
| `get_astronomy_time_series` | 1 per request | Yes |
| `parse_user_agent` | 1 | No |
| `bulk_parse_user_agent` | 1 per UA | No |
| `lookup_asn` | 1 | No |
| `get_abuse_contact` | 1 | No |
| `lookup_company` | 1 | No |
| `lookup_currency` | 1 | Yes |
| `lookup_network` | 1 | No |
| `get_my_ip` | 0 | Yes |

For current plan details, monthly credits, and pricing, please visit our [pricing page](https://ipgeolocation.io/pricing.html).

## Error Handling

All tools return structured errors instead of crashing the server.

| Code | Meaning |
|------|---------|
| `400` | Invalid or incomplete parameters, invalid date or time format, missing coordinate pairs, or unsupported input combinations |
| `401` | Missing or invalid API key, free plan calling a paid-only capability, or unsupported non-English `lang` on the free plan |
| `404` | Endpoint-specific resource not found, such as an ASN lookup target that does not exist |
| `405` | Endpoint-specific method or subscription restriction returned by the upstream API |
| `423` | Bogon or private IP address such as `10.x.x.x` or `192.168.x.x` |
| `429` | Rate limit, daily credit limit, or account quota exceeded |
| `499` | Endpoint-specific validation or unsupported query state returned by the upstream API |
| `502` | MCP server could not reach the upstream API or received an invalid upstream response |
| `504` | MCP server timed out while waiting for the upstream API |

Exact status codes can vary by endpoint and request mode. If an upstream endpoint returns another error, we pass that error back with a structured message.

## Pricing

For current plan details, credits, and pricing, please visit our [pricing page](https://ipgeolocation.io/pricing.html).

## Building from Source

```bash
git clone https://github.com/IPGeolocation/ipgeolocation-io-mcp.git
cd ipgeolocation-io-mcp
npm install
npm run build
```

Run the built server directly:

```bash
IPGEOLOCATION_API_KEY=<IPGEOLOCATION_API_KEY> node dist/index.js
```

Inspect it with the MCP Inspector:

```bash
IPGEOLOCATION_API_KEY=<IPGEOLOCATION_API_KEY> npx @modelcontextprotocol/inspector node dist/index.js
```

## Testing

Run the full test suite:

```bash
npm test
```

Run targeted suites:

```bash
npm run test:unit
npm run test:integration
```

## How It Works

We run this package as a stdio MCP server on top of our v3 API portfolio.

What happens at runtime:

1. Your MCP client starts the server.
2. The client reads the tool list and tool descriptions.
3. The client calls the tool that best fits the prompt.
4. We validate inputs, call the upstream API, and return structured results.
5. For deterministic tools, we keep recent responses in the server process cache so repeated requests for the same input can return faster and avoid duplicate upstream calls.

Three tools, `lookup_company`, `lookup_currency`, and `lookup_network`, are convenience wrappers around the broader IP lookup response. We expose them separately because they are easier for clients to discover when the user only needs one narrow slice of data.

## Caching and Refresh

We cache deterministic tool responses in process memory to reduce repeated upstream requests for the same input.

Why we do this:

- Faster responses for repeated lookups
- Lower credit usage when the same request is asked again
- Less duplicate traffic to upstream APIs
- Better behavior when a client retries or revisits the same question

Important points:

- This is server-side cache in the MCP process, not client model memory
- Default TTL is `300000` ms, which is 5 minutes
- Cache clears when the MCP server process stops or restarts
- A fresh upstream call happens when the TTL expires, the request shape changes, or `force_refresh` is set to `true`

Cached tools:

- `lookup_ip`
- `bulk_lookup_ip`
- `check_security`
- `bulk_security_check`
- `lookup_company`
- `lookup_currency`
- `lookup_network`
- `parse_user_agent`
- `bulk_parse_user_agent`
- `lookup_asn`
- `get_abuse_contact`
- `get_astronomy_time_series`

Live, uncached tools:

- `get_my_ip`
- `get_timezone`
- `convert_timezone`
- `get_astronomy`

Use `force_refresh: true` on cached tools when you explicitly want a fresh upstream response instead of a cached one.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `IPGEOLOCATION_API_KEY` | Yes for most tools | Your ipgeolocation.io API key |
| `IPGEOLOCATION_REQUEST_TIMEOUT_MS` | No | Upstream request timeout in milliseconds. Default `15000`, allowed `1000` to `120000` |
| `IPGEOLOCATION_MCP_CACHE_TTL_MS` | No | Cache TTL in milliseconds. Default `300000`, allowed `1000` to `3600000` |
| `IPGEOLOCATION_MCP_CACHE_MAX_ENTRIES` | No | Max cache entries before eviction. Default `500`, allowed `10` to `5000` |
| `IPGEOLOCATION_MCP_MAX_BULK_ITEMS` | No | Max bulk items accepted per MCP request. Default `1000`, max `50000` |
| `IPGEOLOCATION_MCP_MAX_RESULT_ITEMS` | No | Max array items returned in tool output before truncation. Default `250` |
| `IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS` | No | Max response text length before truncation. Default `200000` |
| `IPGEOLOCATION_MCP_MAX_ERROR_CHARS` | No | Max error text length before truncation. Default `4000` |

## License

[MIT License](https://github.com/IPGeolocation/ipgeolocation-io-mcp/blob/main/LICENSE)

## Privacy Policy

See our [Privacy Policy](https://ipgeolocation.io/privacy.html) for details on how we handle data.

## Links

- [IPGeolocation Website](https://ipgeolocation.io)
- [GitHub Repository](https://github.com/IPGeolocation/ipgeolocation-io-mcp)
- [API Documentation](https://ipgeolocation.io/documentation.html)
- [Pricing](https://ipgeolocation.io/pricing.html)
- [Sign Up](https://app.ipgeolocation.io/signup)
