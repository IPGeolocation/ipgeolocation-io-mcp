import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAsn } from "../client.js";

export function registerAsnTools(server: McpServer) {
  server.registerTool(
    "lookup_asn",
    {
      description: `Look up detailed Autonomous System Number (ASN) information using ipgeolocation.io's dedicated ASN endpoint (GET /v3/asn). Paid plans only. Free plan returns 401 Unauthorized. Costs 1 credit per lookup.

Query by AS number (e.g. AS13335) or by IP address to find its ASN. Returns: as_number, asn_name, organization, country, type (ISP/Business/Hosting/etc), domain, rir (ARIN/RIPE/APNIC/etc), date_allocated, allocation_status, num_of_ipv4_routes, num_of_ipv6_routes.

Optional include parameter adds: peers (peer ASNs), downstreams (downstream ASNs), upstreams (upstream ASNs), routes (announced IPv4/IPv6 routes), whois_response (raw WHOIS text).

Note: basic ASN data (as_number, organization, country) is already included in lookup_ip responses on all plans including free. Paid plan lookup_ip also returns type, domain, date_allocated, and rir. This dedicated endpoint adds asn_name, allocation_status, route counts, and the optional peers/downstreams/upstreams/routes/whois data that lookup_ip does not provide. Use lookup_ip for basic ASN info. Use this tool only when you need the extended ASN details.`,
      inputSchema: {
        asn: z
          .string()
          .optional()
          .describe(
            "AS number to look up (e.g. AS13335 or just 13335). Takes priority over ip if both are provided."
          ),
        ip: z
          .string()
          .optional()
          .describe(
            "IPv4 or IPv6 address to find the ASN for. Used only if asn is not provided."
          ),
        include: z
          .string()
          .optional()
          .describe(
            "Comma-separated extra data to include: peers, downstreams, upstreams, routes, whois_response. No additional credit cost."
          ),
        fields: z
          .string()
          .optional()
          .describe(
            "Comma-separated dot-path fields to return (e.g. asn.as_number,asn.organization). Overrides include if both are set."
          ),
        excludes: z
          .string()
          .optional()
          .describe(
            "Comma-separated dot-path fields to exclude (e.g. asn.date_allocated,asn.rir)."
          ),
      },
    },
    async (params) => {
      try {
        const result = await getAsn(params);
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
              text: `Error: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
