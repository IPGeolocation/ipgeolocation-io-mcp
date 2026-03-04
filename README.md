# IPGeolocation.io MCP Server

Official [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for the [ipgeolocation.io](https://ipgeolocation.io) API suite (v3). Connects Claude, Cursor, Windsurf, VS Code Copilot, and any MCP-compatible AI assistant to our full range of IP intelligence, timezone, astronomy, and user-agent parsing APIs.

Built and maintained by the [ipgeolocation.io](https://ipgeolocation.io) team.

---

## Features

- **16 tools** covering IP geolocation, VPN/proxy detection, timezone, astronomy, user-agent parsing, ASN, and abuse contact data
- **Zero-install setup** with `npx` for any MCP client
- **Free tier included** with 1,000 credits/day for 7 tools
- **Bulk operations** for IP geolocation, security checks, and user-agent parsing (up to 50,000 per request)
- **Cost optimization** built into tool descriptions so AI assistants pick the cheapest path automatically

---

## Quick Start

### 1. Get your API key

Sign up at [app.ipgeolocation.io/signup](https://app.ipgeolocation.io/signup) (free, no credit card). Copy your API key from the Dashboard.

### 2. Add to your AI client

<details>
<summary><strong>Claude Desktop</strong></summary>

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ipgeolocation": {
      "command": "npx",
      "args": ["-y", "ipgeolocation-io-mcp"],
      "env": {
        "IPGEOLOCATION_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Cursor</strong></summary>

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "ipgeolocation": {
      "command": "npx",
      "args": ["-y", "ipgeolocation-io-mcp"],
      "env": {
        "IPGEOLOCATION_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Windsurf</strong></summary>

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "ipgeolocation": {
      "command": "npx",
      "args": ["-y", "ipgeolocation-io-mcp"],
      "env": {
        "IPGEOLOCATION_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>VS Code / GitHub Copilot</strong></summary>

Add to your VS Code `settings.json`:

```json
{
  "mcp": {
    "servers": {
      "ipgeolocation": {
        "command": "npx",
        "args": ["-y", "ipgeolocation-io-mcp"],
        "env": {
          "IPGEOLOCATION_API_KEY": "your-api-key-here"
        }
      }
    }
  }
}
```

</details>

### 3. Start asking questions

> "Where is 8.8.8.8 located?"
> "Is this IP behind a VPN? 1.2.3.4"
> "What time is it in Tokyo right now?"
> "When is sunrise tomorrow in London?"
> "Parse this user-agent string: Mozilla/5.0..."

---

## Tools

### Free Plan (1,000 credits/day)

| Tool | Description | Credits |
|------|-------------|---------|
| `lookup_ip` | IP geolocation, country metadata, currency, timezone, basic ASN | 1 |
| `get_my_ip` | Returns the caller's public IP address (no API key needed) | 0 |
| `lookup_currency` | Currency code/name/symbol and country metadata for any IP | 1 |
| `get_timezone` | Timezone details by IANA name, coordinates, IP, IATA/ICAO code, or UN/LOCODE | 1 |
| `convert_timezone` | Convert time between two locations using timezone names, coordinates, or airports | 1 |
| `get_astronomy` | Sunrise, sunset, moonrise, moonset, twilight, golden hour, moon phases | 1 |
| `get_astronomy_time_series` | Daily astronomy data for a date range (up to 90 days) | 1 |

### Paid Plans

| Tool | Description | Credits |
|------|-------------|---------|
| `bulk_lookup_ip` | Geolocation for up to 50,000 IPs in one request | 1/IP |
| `check_security` | VPN, proxy, Tor, bot detection with confidence scores and provider names | 2 |
| `bulk_security_check` | Security check for up to 50,000 IPs in one request | 2/IP |
| `lookup_company` | Organization using an IP vs. ASN holder comparison (detects subleasing) | 1 |
| `lookup_network` | BGP route prefix, connection type, anycast detection | 1 |
| `parse_user_agent` | Parse any user-agent string into device, browser, OS, engine details | 1 |
| `bulk_parse_user_agent` | Parse up to 50,000 user-agent strings in one request | 1/UA |
| `lookup_asn` | ASN details with peers, upstreams, downstreams, routes, WHOIS data | 1 |
| `get_abuse_contact` | Abuse contact email, phone, address, and organization for any IP | 1 |

Paid plans also add network, company, and extended ASN fields to `lookup_ip`, plus the `include` parameter for security (+2), abuse (+1), hostname, user-agent, geo-accuracy, DMA code, or all modules at once (4 credits total).

---

## Tool Details

<details>
<summary><strong>lookup_ip</strong> - IP geolocation lookup</summary>

Geolocation data for any IPv4/IPv6 address or domain. Uses GET `/v3/ipgeo`. Costs 1 credit.

**Free plan returns:** IP, location (continent, country, state, district, city, zipcode, coordinates, is_eu, country_flag, country_emoji, geoname_id), country_metadata (calling_code, tld, languages), currency (code, name, symbol), timezone (name, offset, DST info, current_time), basic ASN (as_number, organization, country).

**Paid plans add:** network (connection_type, route, is_anycast), company (name, type, domain), extended ASN (type, domain, date_allocated, rir). The ASN object is the organization holding the IP block allocation from a registry. The company object is the organization actually using that IP. They match when the ASN holder uses the IPs directly, and differ when IPs are subleased.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ip` | No | IP address or domain. Domain lookups require a paid plan. Omit to look up the caller's IP |
| `lang` | No | Response language (en, de, ru, ja, fr, cn, es, cs, it, ko, fa, pt). Paid only |
| `include` | No | Extra modules: `security` (+2), `abuse` (+1), `hostname`, `user_agent`, `geo_accuracy`, `dma_code`, or `*` for all (4 total). Paid only |
| `fields` | No | Comma-separated fields to return. Works on all plans |
| `excludes` | No | Comma-separated fields to exclude. Works on all plans |

**Cost optimization:** Use `include=security&fields=security` to get only security data for 2 credits instead of 3. Use `include=abuse&fields=abuse` for abuse data at 1 credit instead of 2.

</details>

<details>
<summary><strong>bulk_lookup_ip</strong> - Bulk IP geolocation</summary>

Geolocation data for up to 50,000 IPs in one POST request. Uses POST `/v3/ipgeo-bulk`. Paid plans only.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ips` | Yes | Array of IP addresses or domains (1 to 50,000) |
| `lang` | No | Response language. Defaults to en |
| `include` | No | Extra modules per IP: `security` (+2/IP), `abuse` (+1/IP), `hostname`, `user_agent`, `geo_accuracy`, `dma_code`, or `*` (4/IP total) |
| `fields` | No | Comma-separated fields to return per IP |
| `excludes` | No | Comma-separated fields to exclude per IP |

</details>

<details>
<summary><strong>get_my_ip</strong> - Get caller's public IP</summary>

Returns the public IP of the machine running this server. No parameters, no API key needed, no credits charged.

</details>

<details>
<summary><strong>check_security</strong> - VPN/proxy/threat detection</summary>

Check any IP against our threat intelligence database. Uses GET `/v3/security`. Paid plans only, 2 credits.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ip` | No | IP to check. Omit to check caller's IP |
| `fields` | No | Specific fields to return |
| `excludes` | No | Fields to exclude |

**Returns:** threat_score (0-100), is_tor, is_proxy, proxy_provider_names, proxy_confidence_score, proxy_last_seen, is_residential_proxy, is_vpn, vpn_provider_names, vpn_confidence_score, vpn_last_seen, is_relay, relay_provider_name, is_anonymous, is_known_attacker, is_bot, is_spam, is_cloud_provider, cloud_provider_name.

This returns the same data as `lookup_ip` with `include=security`, but costs 2 credits instead of 3 because it skips the base geolocation.

</details>

<details>
<summary><strong>bulk_security_check</strong> - Bulk security check</summary>

Same as `check_security` but for up to 50,000 IPs. Paid plans only, 2 credits per valid IP.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ips` | Yes | Array of IP addresses (1 to 50,000) |
| `fields` | No | Comma-separated fields to return per IP |
| `excludes` | No | Comma-separated fields to exclude per IP |

</details>

<details>
<summary><strong>get_timezone</strong> - Timezone lookup</summary>

Timezone information for any location. Uses GET `/v3/timezone`. Works on all plans, 1 credit.

Look up by timezone name, coordinates, city, IP, airport code, or UN/LOCODE. All lookup modes work on free and paid plans.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `tz` | No | IANA timezone name (e.g. `America/New_York`) |
| `lat` + `long` | No | Coordinates |
| `location` | No | City or address (e.g. `London, UK`) |
| `ip` | No | IP address |
| `iata_code` | No | 3-letter IATA airport code (e.g. `JFK`). Also returns airport details |
| `icao_code` | No | 4-letter ICAO airport code (e.g. `KJFK`). Also returns airport details |
| `lo_code` | No | 5-character UN/LOCODE (e.g. `USNYC`) |
| `lang` | No | Response language for IP lookups. Paid only |

**Returns:** Timezone name, UTC offset, current time in multiple formats, DST status, DST transition dates. Airport lookups also return airport name, city, elevation, and coordinates.

</details>

<details>
<summary><strong>convert_timezone</strong> - Timezone conversion</summary>

Convert a time from one location to another. Uses GET `/v3/timezone/convert`. Works on all plans, 1 credit.

Both source and destination can be timezone names, coordinates, cities, airport codes, or UN/LOCODEs.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `time` | No | Time to convert (`yyyy-MM-dd HH:mm`). Defaults to now |
| `tz_from` / `tz_to` | No | IANA timezone names |
| `lat_from` + `long_from` / `lat_to` + `long_to` | No | Coordinates |
| `location_from` / `location_to` | No | City or address strings |
| `iata_from` / `iata_to` | No | IATA airport codes |
| `icao_from` / `icao_to` | No | ICAO airport codes |
| `locode_from` / `locode_to` | No | UN/LOCODEs |

**Returns:** Original time, converted time, diff_hour, and diff_min.

</details>

<details>
<summary><strong>get_astronomy</strong> - Astronomy data</summary>

Astronomical data for any location on any date. Uses GET `/v3/astronomy`. Works on all plans, 1 credit.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `lat` + `long` | No | Coordinates (highest priority) |
| `location` | No | City or address |
| `ip` | No | IP address |
| `date` | No | Date in `YYYY-MM-DD` format. Defaults to today |
| `elevation` | No | Meters above sea level (0-10000) |
| `time_zone` | No | IANA timezone to express times in |
| `lang` | No | Response language for IP lookups. Paid only |

**Returns:** Sunrise/sunset, moonrise/moonset, all twilight phases (civil, nautical, astronomical), golden hour, blue hour, solar noon, day length, sun and moon altitude/azimuth/distance, moon phase and illumination percentage.

</details>

<details>
<summary><strong>get_astronomy_time_series</strong> - Astronomy time series</summary>

Daily astronomical data for a date range in a single request. Uses GET `/v3/astronomy/timeSeries`. Works on all plans, 1 credit per request regardless of range length.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `lat` + `long` | No | Coordinates (highest priority) |
| `location` | No | City or address |
| `ip` | No | IP address |
| `dateStart` | Yes | Start date in `YYYY-MM-DD` format |
| `dateEnd` | Yes | End date in `YYYY-MM-DD` format. Maximum span is 90 days |
| `elevation` | No | Meters above sea level (0-10000) |
| `time_zone` | No | IANA timezone to express times in |
| `lang` | No | Response language for IP lookups. Paid only |

Does not include real-time positional data (sun/moon altitude, azimuth, distance). For that, use `get_astronomy` with a specific date.

</details>

<details>
<summary><strong>parse_user_agent</strong> - User-agent parsing</summary>

Parse any user-agent string into structured device, browser, OS, and engine details. Uses POST `/v3/user-agent`. Paid plans only, 1 credit.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `uaString` | Yes | The user-agent string to parse |

**Returns:** user_agent_string, name (browser/bot name), type (Browser, Crawler, etc.), version, version_major, device (name, type, brand, cpu), engine (name, type, version, version_major), operating_system (name, type, version, version_major, build).

</details>

<details>
<summary><strong>bulk_parse_user_agent</strong> - Bulk user-agent parsing</summary>

Parse up to 50,000 user-agent strings in a single request. Uses POST `/v3/user-agent-bulk`. Paid plans only, 1 credit per UA string.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `uaStrings` | Yes | Array of user-agent strings (1 to 50,000) |

</details>

<details>
<summary><strong>lookup_company</strong> - Company/organization lookup</summary>

Identify which organization is using a specific IP address. Uses GET `/v3/ipgeo` with fields filtered to company and ASN data. Paid plans only, 1 credit.

Returns two objects: the company using the IP and the ASN holder. They match when the ASN holder uses the IPs directly, and differ when IPs are subleased. For example, 1.1.1.1 has ASN "Cloudflare, Inc." (who routes it) but company "APNIC Research and Development" (who owns the block).

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ip` | No | IP address to look up. Omit to check the caller's IP |

**Returns:** company (name, type, domain) and asn (as_number, organization, country, type, domain, date_allocated, rir).

</details>

<details>
<summary><strong>lookup_currency</strong> - Currency and country metadata</summary>

Local currency and country metadata for any IP address. Uses GET `/v3/ipgeo` with fields filtered to currency and country_metadata. Works on all plans, 1 credit.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ip` | No | IP address to look up. Omit to check the caller's IP |

**Returns:** currency (code, name, symbol) and country_metadata (calling_code, tld, languages). For example, a Japanese IP returns currency code "JPY", name "Japanese Yen", symbol "¥", calling code "+81", TLD ".jp", and languages ["ja"].

</details>

<details>
<summary><strong>lookup_network</strong> - Network/routing info</summary>

Network routing information and anycast detection. Uses GET `/v3/ipgeo` with fields filtered to network data. Paid plans only, 1 credit.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ip` | No | IP address to look up. Omit to check the caller's IP |

**Returns:** network (connection_type, route, is_anycast). The route field shows the announced BGP prefix (e.g. "1.1.1.0/24"). The is_anycast field indicates whether the IP is served from multiple geographic locations via anycast routing.

</details>

<details>
<summary><strong>lookup_asn</strong> - ASN details</summary>

Detailed ASN information. Uses GET `/v3/asn`. Paid plans only, 1 credit.

Basic ASN data (as_number, organization, country) is already included in every `lookup_ip` response on all plans. This dedicated endpoint adds asn_name, allocation_status, route counts, and optional peers/downstreams/upstreams/routes/whois data.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `asn` | No | AS number (e.g. `AS13335` or `13335`) |
| `ip` | No | IP address to find its ASN |
| `include` | No | Extra data: `peers`, `downstreams`, `upstreams`, `routes`, `whois_response` |
| `fields` | No | Specific fields to return |
| `excludes` | No | Fields to exclude |

**Returns:** AS number, asn_name, organization, country, type (ISP/Business/Hosting/etc), domain, RIR, allocation date, allocation status, IPv4 and IPv6 route counts. Optionally: peer/upstream/downstream ASNs, announced routes, raw WHOIS text.

</details>

<details>
<summary><strong>get_abuse_contact</strong> - Abuse contact lookup</summary>

Find who to contact about abuse from a given IP. Uses GET `/v3/abuse`. Paid plans only, 1 credit.

Abuse data is also available through `lookup_ip` with `include=abuse` (2 credits total). This dedicated endpoint is cheaper at 1 credit when you only need the abuse contact without geolocation.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ip` | No | IP address. Omit to use caller's IP |
| `fields` | No | Comma-separated fields to return |
| `excludes` | No | Comma-separated fields to exclude |

**Returns:** Organization name, abuse email addresses, phone numbers, mailing address, network route, country, and kind.

</details>

---

## Credit Costs

Each API call uses credits from your ipgeolocation.io account:

| Action | Credits | Free Plan |
|--------|---------|-----------|
| IP geolocation lookup (base) | 1 | Yes |
| + security module (`include=security`) | +2 (3 total) | No |
| + abuse module (`include=abuse`) | +1 (2 total) | No |
| + all modules (`include=*`) | 4 total | No |
| Security-only via fields trick | 2 | No |
| Abuse-only via fields trick | 1 | No |
| Bulk IP geolocation | 1 per IP | No |
| Security check (single) | 2 | No |
| Security check (bulk) | 2 per IP | No |
| Timezone lookup | 1 | Yes |
| Timezone conversion | 1 | Yes |
| Astronomy lookup | 1 | Yes |
| Astronomy time series | 1 | Yes |
| User-agent parse (single) | 1 | No |
| User-agent parse (bulk) | 1 per UA | No |
| ASN lookup | 1 | No |
| Abuse contact lookup | 1 | No |
| Company lookup | 1 | No |
| Currency/country metadata | 1 | Yes |
| Network/anycast lookup | 1 | No |
| Get my IP | 0 | Yes |

---

## Error Handling

All tools return structured error messages instead of crashing the server.

| Code | Meaning |
|------|---------|
| 401 | Invalid or missing API key, free plan calling a paid-only endpoint, domain lookup on free plan, or non-English `lang` on free plan |
| 423 | Bogon or private IP address (192.168.x.x, 10.x.x.x, etc.) |
| 429 | Rate limit or daily credit limit exceeded |

---

## Pricing

> As of February 2026. See [ipgeolocation.io/pricing](https://ipgeolocation.io/pricing.html) for current rates.

| Plan | Credits | Price |
|------|---------|-------|
| Free / Developer | 1,000/day | $0 forever |
| Starter | 150,000/month | $19/month |
| Core | 250,000/month | $29/month |
| Plus | 500,000/month | $49/month |
| Pro | 1,000,000/month | $79/month |
| Business | 2,000,000/month | $129/month |
| Premium | 5,000,000/month | $249/month |

No per-second rate limits on any plan.

---

## Building from Source

```bash
git clone https://github.com/IPGeolocation/ipgeolocation-io-mcp.git
cd ipgeolocation-io-mcp
npm install
npm run build
```

Run directly:

```bash
IPGEOLOCATION_API_KEY=your-key node dist/index.js
```

Test with the MCP inspector:

```bash
IPGEOLOCATION_API_KEY=your-key npx @modelcontextprotocol/inspector node dist/index.js
```

---

## How It Works

This is a stdio-based MCP server that wraps our REST API (v3). When an AI client starts it, the server communicates over stdin/stdout using the Model Context Protocol. The client sees the available tools, and when the AI needs IP geolocation data, VPN detection, timezone info, or any other supported lookup, it calls the appropriate tool. The server makes the API request and returns the result.

All 16 tools map to our v3 API endpoints. Three tools (`lookup_company`, `lookup_currency`, `lookup_network`) are convenience wrappers around `/v3/ipgeo` that pre-filter fields for specific use cases, making them easier for AI assistants to discover and select.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `IPGEOLOCATION_API_KEY` | Yes (for most tools) | Your ipgeolocation.io API key |

`get_my_ip` works without any API key.

---

## License

MIT

## Links

- [ipgeolocation.io](https://ipgeolocation.io) - IP geolocation, security, timezone, astronomy, user-agent, and ASN APIs
- [API Documentation](https://ipgeolocation.io/documentation.html) - Full API reference
- [Pricing](https://ipgeolocation.io/pricing.html) - Free and paid plan details
- [Sign Up](https://app.ipgeolocation.io/signup) - Get your free API key
