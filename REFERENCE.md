# Tool and Configuration Reference

Use this reference when writing tool calls, handling results or changing server settings. For installation and everyday use, start with [README](README.md).

This reference covers [version 2.0.3](https://github.com/IPGeolocation/ipgeolocation-io-mcp/releases/tag/v2.0.3).

## Contents

- [Tool reference](#tool-reference)
- [Response format](#response-format)
- [Error codes](#error-codes)
- [Caching](#caching)
- [Environment variables](#environment-variables)
- [Network proxies](#network-proxies)
- [Cached result pagination](#cached-result-pagination)
- [Example answers and tool output](#example-answers-and-tool-output)
- [Credential masking](#credential-masking)

## Tool Reference

Tool arguments must match the advertised schema. Unknown parameters are rejected locally before any API request, so a misspelled selector cannot silently look up the server's IP.

Coordinates, including conversion selectors, and `elevation` take string values, such as `"24.86"` and `"10"`. `force_refresh` takes a boolean.

### lookup_ip

Single IP or domain lookup through the [IP Geolocation API](https://ipgeolocation.io/documentation/ip-location-api.html). **Free and paid. 1 credit for base IP data.**

Use this when you need location, time zone, currency, or ASN for one IP address. On paid plans you can add `include` modules to pull security, abuse, or hostname data in the same call, which avoids extra requests.

Free plan returns base location, country metadata, currency, time zone, and basic ASN. Paid plans add `network`, `company`, extended ASN, and the `include` parameter. Note that domain lookups require a paid plan.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ip` | No | IPv4, IPv6, or domain. Domain lookup requires a paid plan. |
| `lang` | No | Response language. Non-English requires a paid plan. |
| `include` | No | Extra modules on Paid: `security`, `abuse`, `hostname`, `liveHostname`, `hostnameFallbackLive`, `user_agent`, `geo_accuracy`, `dma_code`, or `*`. On Free, `*` returns base data only. |
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

Accuracy and DMA values appear inside `location`. An explicit include keeps its module present even if `fields` omits it. Selecting children of an included module keeps only those children. A recognized include protects its response root from a whole-root exclusion: `security` protects `security`, while `geo_accuracy` and `dma_code` protect `location`. A root named only by `fields` can still be excluded. Nested exclusions apply; removing the last selected child also removes its empty parent. `include=*` follows field selection and exclusions without protecting roots. Cached results follow the same rules as fresh responses.

The `user_agent` include parses this server's outbound User-Agent header, normally `node`. It cannot identify a browser or device from the target IP. To parse a known visitor's user agent, pass the exact string to `parse_user_agent` or `bulk_parse_user_agent`.

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

Current time and time zone details for a location through the [Time Zone API](https://ipgeolocation.io/documentation/timezone-api.html). **Free and paid. 1 credit.**

Accepts IANA time zone names, coordinates, IP addresses, airport codes (IATA/ICAO), or UN/LOCODEs. The response includes time zone offsets, date/datetime variants, `current_time`, `current_time_unix`, `time_24`, `time_12`, `week`, `month`, `year`, time zone abbreviations, and DST transition details.

With no selector, the API uses the server machine's public egress IP, which can differ from your IP.

Always hits the network (not cached) because it returns the current time.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `tz` | No | IANA time zone name (e.g., `America/New_York`) |
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
| `tz_from` / `tz_to` | No | IANA time zone names |
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
| `elevation` | No | Meters, up to 10000. Negative values are treated as 0. |
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
| `elevation` | No | Meters, up to 10000. Negative values are treated as 0. |
| `time_zone` | No | IANA name to control output times |
| `lang` | No | Response language. Non-English requires a paid plan. |
| `force_refresh` | No | Skip the cache |

### parse_user_agent

Parses one UA string into browser, device, OS, and engine data through the [User Agent API](https://ipgeolocation.io/documentation/user-agent-api.html). **Paid. 1 credit.**

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

Returns `company` and `asn` objects. `lookup_ip` returns the same data plus location, time zone, and more. Use this when the company/ASN pair is all you need and you want a smaller response.

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

## Response Format

| Result | `structuredContent` |
|--------|---------------------|
| Single JSON lookup | `{ "data": ... }` |
| Public egress IP | `{ "ip": "..." }` |
| Bulk lookup | `{ "items": [...], "errors": [...] }` |
| Oversized success | `{ "page": ... }` |
| Whole-call failure | `{ "error": ... }` with `isError: true` |

Normal text responses keep the API's JSON format, or a plain IP string for `get_my_ip`. Oversized successful responses contain a page in both text and structured content.

## Error Codes

Tool failures return `isError: true`, readable text, and `structuredContent.error` with a redacted, length-limited message, category, retryability, and guidance:

| Failure origin | Structured details |
|----------------|--------------------|
| HTTP error response received from the API | `source: "ipgeolocation_api"`; `status` is the received HTTP status |
| Registered-schema rejection: wrong field type, missing required field, unknown parameter, or oversized batch | `source: "mcp_server"`, `category: "validation"`, `retryable: false`; rejected before an API call |
| Handler validation (such as dates or coordinate pairs), missing API key, or unavailable cached result | `source: "mcp_server"`, `category: "tool_error"`, `retryable: false`; no HTTP status is invented |
| API key contains unsupported characters | `source: "mcp_server"`, `category: "configuration"`, local `status: 400`, `retryable: false`; rejected before an API call |
| Local request timeout | `source: "mcp_server"`, `category: "timeout"`, local `status: 504`; `retryable: false` if the API returned a success status before the timeout; otherwise `retryable: true` |
| Connection failure | `source: "mcp_server"`, `category: "upstream_request"`, local `status: 502`; follow the returned retry guidance |
| Invalid upstream JSON, UTF-8, payload shape, or nesting above 64 levels | `source: "mcp_server"`, `category: "upstream_response"`, local `status: 502`, `retryable: false`; the API may already have processed the request |
| Tool arguments, upstream success body, or required pagination snapshot exceeds a resource limit | Local `resource_limit`, `retryable: false`; argument rejection precedes the API request, while body/snapshot rejection can happen after credits were used |
| Cancelled lookup | If cancellation reaches the server before it replies, no result is sent. The API may already have processed the request, so a new attempt can use credits. |
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

## Caching

The server stores cached responses in process memory and shares identical requests already running for the same API key. Sessions using the same key share the cache namespace; different keys use separate namespaces.

| Cached data | Default expiry | Reads extend expiry? |
|-------------|----------------|----------------------|
| Normal tool response | 5 minutes after storage | No |
| Complete pagination snapshot | 5 minutes of idle time | Yes, after each successful `get_cached_result` read |

Both use `IPGEOLOCATION_MCP_CACHE_TTL_MS` (`300000` ms by default). The default cache holds up to 500 entries within a 32 MiB data budget. Larger results may not fit. A lookup can use API credits even when its result cannot be cached. The cache budget does not cap the server's total memory use.

Expiry, eviction, or process restart can make cached data unavailable. `get_cached_result` then fails locally without refetching. Repeating the original lookup after a cache miss can consume credits again.

`force_refresh: true` starts a new upstream request, even if an identical request is running. For IP lookups, a successful refresh clears cached views with the same IP, language and include set. Other include sets are cached separately. Older requests cannot overwrite the refreshed data.

**Cached:** `lookup_ip`, `bulk_lookup_ip`, `check_security`, `bulk_security_check`, `lookup_company`, `lookup_currency`, `lookup_network`, `parse_user_agent`, `bulk_parse_user_agent`, `lookup_asn`, `get_abuse_contact`, `get_astronomy_time_series`

**Always live (not cached):** `get_my_ip`, `get_timezone`, `convert_timezone`, `get_astronomy`

## Environment Variables

Invalid or out-of-range numeric settings use their defaults.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `IPGEOLOCATION_API_KEY` | Yes (most tools) | | Your IPGeolocation.io API key |
| `IPGEOLOCATION_REQUEST_TIMEOUT_MS` | No | `15000` | Upstream deadline in ms, including response-body reading. Range: 1000-120000 |
| `IPGEOLOCATION_MCP_CACHE_TTL_MS` | No | `300000` | Normal-response TTL and page-snapshot idle TTL in ms. Range: 1000-3600000 |
| `IPGEOLOCATION_MCP_CACHE_MAX_ENTRIES` | No | `500` | Maximum cached responses and page snapshots; also subject to the cache byte budget. Range: 10-5000 |
| `IPGEOLOCATION_MCP_CACHE_MAX_BYTES` | No | `33554432` (32 MiB) | Accounted cache-data budget shared by responses and snapshots; not a process-memory limit. Range: 4194304-1073741824 (4 MiB-1 GiB) |
| `IPGEOLOCATION_UPSTREAM_MAX_RESPONSE_BYTES` | No | `8388608` (8 MiB) | Maximum successful upstream body bytes after HTTP decompression. Range: 1048576-268435456 (1-256 MiB) |
| `IPGEOLOCATION_MCP_MAX_ARGUMENT_BYTES` | No | `4194304` (4 MiB) | Maximum UTF-8 bytes of serialized tool arguments before an API request. Range: 65536-33554432 (64 KiB-32 MiB) |
| `IPGEOLOCATION_MCP_MAX_BULK_ITEMS` | No | `1000` | Bulk input ceiling, also capped by `IPGEOLOCATION_MCP_MAX_RESULT_ITEMS`. Range: 1-50000 |
| `IPGEOLOCATION_MCP_MAX_RESULT_ITEMS` | No | `250` | Bulk input/result item ceiling; nested arrays remain complete. Range: 1-50000 |
| `IPGEOLOCATION_MCP_MAX_RESPONSE_CHARS` | No | `200000` | Maximum UTF-8 bytes of a complete serialized tool result, including text and structured content. Oversized successes use cached pages when the full snapshot fits; oversized errors shorten messages. Range: 10000-2000000 |
| `IPGEOLOCATION_MCP_MAX_ERROR_CHARS` | No | `4000` | Upper limit on error-message characters before truncation markers. The complete response byte budget can shorten messages further. Range: 200-50000 |

Bulk batches above the effective item limit are rejected before an upstream request, without using API credits. Raising only `IPGEOLOCATION_MCP_MAX_BULK_ITEMS` does not raise the effective limit; raise both item settings if larger batches are needed.

The response limit includes both text and structured content, JSON escaping, and UTF-8 encoding. Results retain every record and nested array through cached pages when the full snapshot fits the cache budget; an unavailable snapshot returns a local error instead of partial data. Oversized errors shorten only their messages, preserving their category, retryability, guidance, and any status.

Input and response limits protect against unusually large requests and results. See [resource limits](CONTRIBUTING.md#resource-limits) for the technical details.

## Network Proxies

For a network that requires a proxy, use Node.js 22.21 or later in the 22.x series, or Node.js 24 or later. Set `NODE_USE_ENV_PROXY=1` and `HTTPS_PROXY` to your proxy URL in the environment that starts the MCP server, then restart it. `NO_PROXY` can list hosts that should connect directly. See [Node.js proxy settings](https://nodejs.org/api/cli.html#node_use_env_proxy1).

Node.js 22.0 supports the server but does not support these proxy settings. Setting `HTTPS_PROXY` alone does not enable proxy routing. A proxy HTTP 407 response appears as a local `upstream_request` error. Check the proxy address and sign-in settings first.

## Cached Result Pagination

`get_cached_result` costs **0 credits** and never calls the API, including when its cursor is invalid, expired, evicted, or unavailable after a server restart. It accepts one required `cursor`, returned in `page.cursor` or `page.next_cursor`. Use the same server process and API key.

A large original lookup returns `{ "page": ... }` instead of its normal `data` or `items`/`errors` when the complete snapshot fits the cache budget. If it cannot fit, the tool returns a local `resource_limit` error without a cursor; the lookup may already have used credits. Each available page contains:

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

Use cursors to retrieve remaining data. The [cache rules](#caching) explain snapshot expiry, eviction, API key isolation, and when a new lookup can consume credits.

## Example Answers and Tool Output

The text answers below are illustrative; exact wording depends on the model. JSON blocks are shortened examples, not current measurements. Location, ownership, contacts, and current-time fields can change.

### Single IP lookup

**Prompt:** Locate 91.128.103.196 and give me the country, city, ASN, and local time.

**Example answer:** 91.128.103.196 is in Stockholm, Sweden. ASN is AS1257, operated by Tele2 Sverige AB. Time zone is Europe/Stockholm, local time was 2026-02-12 18:36:54.

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


## Credential Masking

The server masks explicit credential fields and configured API-key matches before returning results. Successful data preserves ordinary names and user-agent strings. Error diagnostics also mask recognized credential patterns.

Configured-key matching supports literal text, mixed JSON escapes, `encodeURI`/`encodeURIComponent` output, form encoding, fully percent-encoded text, and one additional `encodeURIComponent` layer over URI/form/percent forms. Matching preserves the key's letter case; it does not guess uppercasing or other transformations.

Keys shorter than four Unicode characters use token boundaries in ordinary text. Unlabeled numbers are masked only when their complete string representation matches a key of at least four characters. Labeled credential fields are always masked in full.

These are masking rules, not permission to put keys in lookup inputs, logs or shared files. Keep credentials in private client configuration or environment settings.
