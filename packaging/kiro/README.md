# IPGeolocation.io for Kiro

The official IPGeolocation.io Power gives Kiro 17 tools for IP geolocation, company information, ASN and network data, IP security (VPN, proxy, Tor, bot, hosting and spam detection), abuse contacts, time zones, astronomy, currency data and user-agent parsing. Use single or bulk lookups for IP investigations and data enrichment, then page through cached results without repeat API calls.

The Power runs `ipgeolocation-io-mcp` locally over stdio and follows npm's `latest` tag. Restart the server to load a new release. It requires Node.js 22 or later, with `npx` on your PATH.

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

To activate this Power, ask Kiro to look up an IP address or identify its company. Most tools require an API key; `get_my_ip` works without one. Data access and credit usage depend on your plan. `get_cached_result` reads saved response pages without making another API request, but only within the same server process and with the same key that made the original lookup.

## Privacy and support

API lookups send their inputs and the server machine's public egress IP to the API provider. Cached responses stay in process memory. Kiro controls its own configuration and logs. See the [privacy policy](https://ipgeolocation.io/privacy.html) and [security policy](https://github.com/IPGeolocation/ipgeolocation-io-mcp/blob/main/SECURITY.md).

Support: [support@ipgeolocation.io](mailto:support@ipgeolocation.io). License: [MIT](https://github.com/IPGeolocation/ipgeolocation-io-mcp/blob/main/LICENSE).
