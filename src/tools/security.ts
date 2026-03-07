import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getSecurity, getSecurityBulk } from "../client.js";
import {
  MAX_BULK_ITEMS,
  errorToolResponse,
  formatToolResult,
} from "./response.js";
import { getCachedValue, setCachedValue } from "./cache.js";
import { applyFieldsAndExcludes } from "./projection.js";

function buildSecurityCacheKey(ip: string | undefined): string {
  return `security|ip=${ip?.trim().toLowerCase() ?? "self"}`;
}

function normalizeCsvForCacheKey(value: string | undefined): string {
  if (!value) {
    return "";
  }
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .sort()
    .join(",");
}

function buildSecurityBulkCacheKey(params: {
  ips: string[];
  fields?: string;
  excludes?: string;
}): string {
  const normalizedIps = params.ips
    .map((ip) => ip.trim().toLowerCase())
    .join(",");
  const normalizedFields = normalizeCsvForCacheKey(params.fields);
  const normalizedExcludes = normalizeCsvForCacheKey(params.excludes);
  return `security-bulk|ips=${normalizedIps}|fields=${normalizedFields}|excludes=${normalizedExcludes}`;
}

export function registerSecurityTools(server: McpServer) {
  server.registerTool(
    "check_security",
    {
      title: "VPN/Proxy/Threat Detection",
      annotations: {
        readOnlyHint: true,
      },
      description: `Decision policy: this is a single-domain tool. Use it only when the user asks for security/threat data only. If the same IP request also needs ownership/company/ASN, location/city, network, timezone, currency, or abuse data, call lookup_ip once with include and targeted fields/excludes instead of chaining tools.

Check if an IP address is a VPN, proxy, Tor node, bot, or known attacker using ipgeolocation.io's dedicated security endpoint (GET /v3/security). Paid plans only. Free plan returns 401 Unauthorized. Costs 2 credits per lookup.

Returns: threat_score (0-100), is_tor, is_proxy, proxy_provider_names, proxy_confidence_score (0-100), proxy_last_seen, is_residential_proxy, is_vpn, vpn_provider_names, vpn_confidence_score (0-100), vpn_last_seen, is_relay, relay_provider_name, is_anonymous, is_known_attacker, is_bot, is_spam, is_cloud_provider, cloud_provider_name.

This is the same security data you get from lookup_ip with include=security, but using this dedicated endpoint costs 2 credits instead of 3 (because you skip the base geolocation). If you need both geolocation and security data together, use lookup_ip with include=security (3 credits) instead. If you only need security data, this tool is cheaper. For checking multiple IPs at once, use bulk_security_check instead.

Tool selection rule: if this tool is used, call it once per IP target and post-process locally. Do not re-call check_security for the same IP just to change fields/excludes or to reformat output.`,
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
        force_refresh: z
          .boolean()
          .optional()
          .describe(
            "Set true to bypass MCP cache and force a new upstream API request."
          ),
      },
    },

    async (params) => {
      try {
        const cacheKey = buildSecurityCacheKey(params.ip);
        const cached = params.force_refresh ? undefined : getCachedValue(cacheKey);

        const baseResult =
          cached ??
          (await getSecurity({
            ip: params.ip,
          }));

        if (cached === undefined) {
          setCachedValue(cacheKey, baseResult);
        }

        const result = applyFieldsAndExcludes(baseResult, {
          fields: params.fields,
          excludes: params.excludes,
          rootKey: "security",
        });

        return {
          content: [
            { type: "text" as const, text: formatToolResult(result) },
          ],
        };
      } catch (error) {
        return errorToolResponse(error);
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
      description: `Decision policy: this is a single-domain bulk tool. Use it only when the user asks for security/threat data only. If each IP request also needs other domains (ownership, location, network, timezone, currency, or abuse), call bulk_lookup_ip once with include and targeted fields/excludes.

Check up to ${MAX_BULK_ITEMS.toLocaleString()} IP addresses for VPN, proxy, Tor, bot, and threat indicators in a single request using ipgeolocation.io's bulk security endpoint (POST /v3/security-bulk). This MCP server caps request size to keep responses manageable over MCP (the raw API supports up to 50,000). Paid plans only. Free plan returns 401 Unauthorized. Costs 2 credits per valid IP in the request.

Returns a JSON array of security assessment objects, one per IP. Each object contains the same fields as check_security: threat_score, is_tor, is_proxy, proxy_provider_names, proxy_confidence_score, is_vpn, vpn_provider_names, vpn_confidence_score, is_bot, is_spam, is_known_attacker, is_anonymous, is_cloud_provider, and more.

Use this tool when you need security checks on multiple IPs at once. For a single IP, use check_security instead. If you also need geolocation data with security, use bulk_lookup_ip with include=security instead (but that costs 3 credits per IP vs 2 credits per IP here).

Tool selection rule: call this tool once per IP batch and post-process locally. Do not re-call bulk_security_check for the same batch only to change fields/excludes or output shape.`,
      inputSchema: {
        ips: z
          .array(z.string())
          .min(1)
          .max(MAX_BULK_ITEMS)
          .describe(
            `Array of IPv4 and/or IPv6 addresses to check. Minimum 1, maximum ${MAX_BULK_ITEMS.toLocaleString()} in this MCP server.`
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
        force_refresh: z
          .boolean()
          .optional()
          .describe(
            "Set true to bypass MCP cache and force a new upstream API request."
          ),
      },
    },
    async (params) => {
      try {
        const cacheKey = buildSecurityBulkCacheKey(params);
        const cached = params.force_refresh ? undefined : getCachedValue(cacheKey);

        const result = cached ?? (await getSecurityBulk(params));
        if (cached === undefined) {
          setCachedValue(cacheKey, result);
        }

        return {
          content: [
            { type: "text" as const, text: formatToolResult(result) },
          ],
        };
      } catch (error) {
        return errorToolResponse(error);
      }
    }
  );
}
