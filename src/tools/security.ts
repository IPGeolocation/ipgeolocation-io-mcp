import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getSecurity, getSecurityBulk } from "../client.js";

export function registerSecurityTools(server: McpServer) {
  server.registerTool(
    "check_security",
    {
      title: "VPN/Proxy/Threat Detection",
      annotations: {
        readOnlyHint: true,
      },
      description: `Check if an IP address is a VPN, proxy, Tor node, bot, or known attacker using ipgeolocation.io's dedicated security endpoint (GET /v3/security). Paid plans only. Free plan returns 401 Unauthorized. Costs 2 credits per lookup.

Returns: threat_score (0-100), is_tor, is_proxy, proxy_provider_names, proxy_confidence_score (0-100), proxy_last_seen, is_residential_proxy, is_vpn, vpn_provider_names, vpn_confidence_score (0-100), vpn_last_seen, is_relay, relay_provider_name, is_anonymous, is_known_attacker, is_bot, is_spam, is_cloud_provider, cloud_provider_name.

This is the same security data you get from lookup_ip with include=security, but using this dedicated endpoint costs 2 credits instead of 3 (because you skip the base geolocation). If you need both geolocation and security data together, use lookup_ip with include=security (3 credits) instead. If you only need security data, this tool is cheaper. For checking multiple IPs at once, use bulk_security_check instead.`,
      inputSchema: {
        ip: z
          .string()
          .optional()
          .describe(
            "IPv4 or IPv6 address to check. Omit to check the caller's IP."
          ),
        fields: z
          .string()
          .optional()
          .describe(
            "Comma-separated dot-path fields to return (e.g. security.threat_score,security.is_vpn). Reduces response size."
          ),
        excludes: z
          .string()
          .optional()
          .describe(
            "Comma-separated dot-path fields to exclude (e.g. security.is_tor,security.is_cloud_provider)."
          ),
      },
    },

    async (params) => {
      try {
        const result = await getSecurity(params);
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

  server.registerTool(
    "bulk_security_check",
    {
      title: "Bulk Security Check",
      annotations: {
        readOnlyHint: true,
      },
      description: `Check up to 50,000 IP addresses for VPN, proxy, Tor, bot, and threat indicators in a single request using ipgeolocation.io's bulk security endpoint (POST /v3/security-bulk). Paid plans only. Free plan returns 401 Unauthorized. Costs 2 credits per valid IP in the request.

Returns a JSON array of security assessment objects, one per IP. Each object contains the same fields as check_security: threat_score, is_tor, is_proxy, proxy_provider_names, proxy_confidence_score, is_vpn, vpn_provider_names, vpn_confidence_score, is_bot, is_spam, is_known_attacker, is_anonymous, is_cloud_provider, and more.

Use this tool when you need security checks on multiple IPs at once. For a single IP, use check_security instead. If you also need geolocation data with security, use bulk_lookup_ip with include=security instead (but that costs 3 credits per IP vs 2 credits per IP here).`,
      inputSchema: {
        ips: z
          .array(z.string())
          .min(1)
          .max(50000)
          .describe(
            "Array of IPv4 and/or IPv6 addresses to check. Minimum 1, maximum 50,000."
          ),
        fields: z
          .string()
          .optional()
          .describe(
            "Comma-separated dot-path fields to return per IP (e.g. security.threat_score,security.is_vpn). Reduces response size."
          ),
        excludes: z
          .string()
          .optional()
          .describe(
            "Comma-separated dot-path fields to exclude per IP (e.g. security.is_tor,security.is_cloud_provider)."
          ),
      },
    },
    async (params) => {
      try {
        const result = await getSecurityBulk(params);
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
