# IPGeolocation.io for Kiro

This Power adds IPGeolocation.io's 17 tools to Kiro for IP geolocation, IP security (VPN, proxy, Tor, bot, hosting and spam detection), ASN details, abuse contacts, time zones, astronomy and user-agent parsing. It supports single and bulk IP lookups for investigations and data enrichment. It also caches responses so you can page through results without making repeat API calls.

The Power runs `ipgeolocation-io-mcp@2.0.1` locally over stdio. It requires Node.js 22 or later, with `npx` on your PATH.

## Install

In Kiro, open **Powers > Add Custom Power > Import power from a folder** and select the `packaging/kiro` directory from a repository checkout. Kiro manages the Power's MCP server separately from servers you configure manually.

For Kiro CLI, run this from the repository root:

```sh
kiro-cli --v3 powers install ./packaging/kiro
```

Start a V3 chat with `kiro-cli --v3`.

Set `IPGEOLOCATION_API_KEY` in the private environment that launches Kiro. The MCP server inherits that environment. Keep the key out of shared files and terminal commands, and restart Kiro after changing its launch environment.

Add this server through only one method to avoid duplicate tool entries. Your other configured servers can stay in place.

## Use

Ask Kiro for an IP geolocation or ASN lookup to activate this Power. API tools use your account's plan and credits. Most tools require an API key; `get_my_ip` works without one. `get_cached_result` reads saved response pages without making another API request, but only within the same server process and with the same key that made the original lookup.

## Privacy and support

API lookups send their inputs and the server machine's public egress IP to the API provider. Cached responses stay in process memory. Kiro controls its own configuration and logs. See the [privacy policy](https://ipgeolocation.io/privacy.html) and [security policy](https://github.com/IPGeolocation/ipgeolocation-io-mcp/blob/v2.0.1/SECURITY.md).

Support: [support@ipgeolocation.io](mailto:support@ipgeolocation.io). License: [MIT](https://github.com/IPGeolocation/ipgeolocation-io-mcp/blob/v2.0.1/LICENSE).
