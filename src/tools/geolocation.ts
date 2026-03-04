import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getIpGeolocation, getIpGeolocationBulk, getMyIp } from "../client.js";

export function registerGeolocationTools(server: McpServer) {
  server.registerTool(
    "lookup_ip",
    {
      title: "IP Geolocation Lookup",
      annotations: {
        readOnlyHint: true,
      },
      description: `Look up geolocation data for a single IP address or domain using ipgeolocation.io's unified endpoint (GET /v3/ipgeo). Costs 1 credit per request on all plans.

FREE PLAN returns: ip, location (continent, country, state, district, city, zipcode, latitude, longitude, is_eu, country_flag, country_emoji, geoname_id), country_metadata (calling_code, tld, languages), currency (code, name, symbol), time_zone (name, offset, DST info, current_time), and basic ASN (as_number, organization, country). The fields and excludes parameters work on the free plan. Domain lookups and the include parameter are not available on the free plan. The lang parameter returns a 401 error on the free plan for any language other than en.

PAID PLANS return everything above plus: network (connection_type, route, is_anycast), company (name, type, domain), and extended ASN (as_number, organization, country, type, domain, date_allocated, rir). The ASN object identifies the organization that holds the IP block allocation from a Regional Internet Registry (ARIN, RIPE, APNIC, etc.). The company object identifies the organization actually using the IP address. These are often the same, but differ when the ASN holder subleases IP space to another organization. For example, the ASN holder might be a cloud provider like Amazon while the company is a business running its infrastructure on that cloud. Paid plans also enable the include parameter to add extra modules: security (+2 credits, 3 total), abuse (+1 credit, 2 total), hostname (+0), liveHostname (+0), hostnameFallbackLive (+0), user_agent (+0), geo_accuracy (+0), dma_code (+0), or * for all (4 credits total). Paid plans support the lang parameter for non-English responses and can look up domains in addition to IPs. Tip: use include=security&fields=security to get only security data for 2 credits instead of 3.

If no IP is provided, returns data for the caller's IP. For basic ASN info on the free plan, use this tool. For detailed ASN data (peers, routes, WHOIS), use lookup_asn instead (paid only). For standalone security checks at 2 credits each, use check_security instead. For standalone abuse lookups at 1 credit, use get_abuse_contact instead.`,
      inputSchema: {
        ip: z
          .string()
          .optional()
          .describe(
            "IPv4 address, IPv6 address, or domain name to look up. Domain lookups require a paid plan. Omit to use the caller's IP."
          ),
        lang: z
          .string()
          .optional()
          .describe(
            "Response language code (en, de, ru, ja, fr, cn, es, cs, it, ko, fa, pt). Paid plans only. Free plan returns a 401 error if you pass any value other than en. Defaults to en."
          ),
        include: z
          .string()
          .optional()
          .describe(
            "Comma-separated extra modules to include in the response. Paid plans only. Options: security (+2 credits), abuse (+1 credit), hostname, liveHostname, hostnameFallbackLive, user_agent, geo_accuracy, dma_code, or * for all (4 credits total). Free plan cannot use this parameter."
          ),
        fields: z
          .string()
          .optional()
          .describe(
            "Comma-separated dot-path fields to return (e.g. location.city,asn.organization). Works on all plans including free. Reduces response size and can reduce credit cost when combined with include."
          ),
        excludes: z
          .string()
          .optional()
          .describe(
            "Comma-separated dot-path fields to exclude from response (e.g. currency,location.continent_code). Works on all plans including free."
          ),
      },
    },
    async (params) => {
      try {
        const result = await getIpGeolocation(params);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "bulk_lookup_ip",
    {
      title: "Bulk IP Geolocation",
      annotations: {
        readOnlyHint: true,
      },
      description: `Look up geolocation data for multiple IP addresses in a single request using ipgeolocation.io's bulk endpoint (POST /v3/ipgeo-bulk). Accepts up to 50,000 IPs per request. Paid plans only. Free plan returns 401 Unauthorized.

Costs 1 credit per IP for base geolocation data. Each IP in the response contains the same fields as a single lookup_ip call on a paid plan: ip, location, country_metadata, currency, time_zone, network, company, and extended ASN (as_number, organization, country, type, domain, date_allocated, rir).

Optional include modules add credits per IP: security (+2 per IP), abuse (+1 per IP), hostname (+0), liveHostname (+0), hostnameFallbackLive (+0), user_agent (+0), geo_accuracy (+0), dma_code (+0), or * for all (4 credits per IP total).

Returns a JSON array with one geolocation object per IP. Use this tool when you need to look up more than one IP at a time. For a single IP lookup, use lookup_ip instead. For bulk security-only checks, use bulk_security_check instead (2 credits per IP).`,
      inputSchema: {
        ips: z
          .array(z.string())
          .min(1)
          .max(50000)
          .describe(
            "Array of IPv4 and/or IPv6 addresses to look up. Minimum 1, maximum 50,000. Domain names are also accepted."
          ),
        lang: z
          .string()
          .optional()
          .describe(
            "Response language code (en, de, ru, ja, fr, cn, es, cs, it, ko, fa, pt). Defaults to en."
          ),
        include: z
          .string()
          .optional()
          .describe(
            "Comma-separated extra modules to include per IP. Options: security (+2 credits/IP), abuse (+1 credit/IP), hostname, liveHostname, hostnameFallbackLive, user_agent, geo_accuracy, dma_code, or * for all (4 credits/IP total)."
          ),
        fields: z
          .string()
          .optional()
          .describe(
            "Comma-separated dot-path fields to return per IP (e.g. location.city,asn.organization). Reduces response size and can reduce credit cost when combined with include."
          ),
        excludes: z
          .string()
          .optional()
          .describe(
            "Comma-separated dot-path fields to exclude per IP (e.g. currency,time_zone)."
          ),
      },
    },
    async (params) => {
      try {
        const result = await getIpGeolocationBulk(params);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "get_my_ip",
    {
      title: "Get My IP Address",
      annotations: {
        readOnlyHint: true,
      },
      description:
        "Get the public IP address of the machine running this MCP server. No API key required. No credits charged. Uses the /v3/getip endpoint. Useful for discovering the server's own IP before doing a geolocation lookup with lookup_ip.",
      inputSchema: {},
    },
    async () => {
      try {
        const ip = await getMyIp();
        return {
          content: [{ type: "text" as const, text: ip }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "lookup_company",
    {
      title: "Company/Organization Lookup",
      annotations: {
        readOnlyHint: true,
      },
      description: `Identify the organization using a specific IP address. Uses ipgeolocation.io's unified endpoint (GET /v3/ipgeo) with fields filtered to company and ASN data. Paid plans only. Free plan does not return company data. Costs 1 credit.

Returns two objects: company (name, type, domain) and asn (as_number, organization, country, type, domain, date_allocated, rir). The ASN object identifies the organization that holds the IP block allocation from a Regional Internet Registry (ARIN, RIPE, APNIC, etc.). The company object identifies the organization actually using the IP address. These are often the same, but differ when the ASN holder subleases IP space to another organization. For example, 1.1.1.1 has ASN organization "Cloudflare, Inc." (who routes it) but company "APNIC Research and Development" (who owns the block).

Use this tool when you need to know which company or organization is behind an IP address. For full geolocation data including company, use lookup_ip instead. For detailed ASN data (peers, routes, WHOIS), use lookup_asn instead.`,
      inputSchema: {
        ip: z
          .string()
          .optional()
          .describe(
            "IPv4 or IPv6 address to look up. Omit to check the caller's IP."
          ),
      },
    },
    async (params) => {
      try {
        const result = await getIpGeolocation({
          ip: params.ip,
          fields: "company,asn",
        });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "lookup_currency",
    {
      title: "Currency and Country Metadata",
      annotations: {
        readOnlyHint: true,
      },
      description: `Get the local currency and country metadata for any IP address. Uses ipgeolocation.io's unified endpoint (GET /v3/ipgeo) with fields filtered to currency and country_metadata. Works on all plans including free. Costs 1 credit.

Returns two objects: currency (code, name, symbol) and country_metadata (calling_code, tld, languages). For example, a Japanese IP returns currency {code: "JPY", name: "Japanese Yen", symbol: "¥"} and country_metadata {calling_code: "+81", tld: ".jp", languages: ["ja"]}.

Use this tool when you need to know the currency, international calling code, country TLD, or spoken languages for an IP's country. For full geolocation data, use lookup_ip instead.`,
      inputSchema: {
        ip: z
          .string()
          .optional()
          .describe(
            "IPv4 or IPv6 address to look up. Omit to check the caller's IP."
          ),
      },
    },
    async (params) => {
      try {
        const result = await getIpGeolocation({
          ip: params.ip,
          fields: "currency,country_metadata",
        });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "lookup_network",
    {
      title: "Network/Routing Info",
      annotations: {
        readOnlyHint: true,
      },
      description: `Get network routing information for any IP address, including whether it uses anycast. Uses ipgeolocation.io's unified endpoint (GET /v3/ipgeo) with fields filtered to network data. Paid plans only. Free plan does not return network data. Costs 1 credit.

Returns: network (connection_type, route, is_anycast). The route field shows the announced BGP prefix (e.g. "1.1.1.0/24"). The is_anycast field indicates whether the IP is served from multiple geographic locations using anycast routing. The connection_type field identifies the type of network connection when available.

Use this tool when you need to check if an IP is anycast, find its BGP route prefix, or identify its connection type. For full geolocation data including network, use lookup_ip instead.`,
      inputSchema: {
        ip: z
          .string()
          .optional()
          .describe(
            "IPv4 or IPv6 address to look up. Omit to check the caller's IP."
          ),
      },
    },
    async (params) => {
      try {
        const result = await getIpGeolocation({
          ip: params.ip,
          fields: "network",
        });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}