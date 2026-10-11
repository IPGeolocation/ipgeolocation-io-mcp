import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getSecurity, getSecurityBulk } from "../client.js";
import {
  MAX_BULK_ITEMS,
  errorToolResponse,
  formatBulkToolResult,
  formatToolResult,
} from "./response.js";
import { getCachedOrFetchValue } from "./cache.js";
import { applyFieldsAndExcludes } from "./projection.js";

function buildSecurityCacheKey(ip: string | undefined): string {
  return `security|${JSON.stringify(ip?.trim().toLowerCase() ?? null)}`;
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
  const normalizedIps = params.ips.map((ip) => ip.trim().toLowerCase());
  const normalizedFields = normalizeCsvForCacheKey(params.fields);
  const normalizedExcludes = normalizeCsvForCacheKey(params.excludes);
  return `security-bulk|${JSON.stringify([normalizedIps, normalizedFields, normalizedExcludes])}`;
}

export function registerSecurityTools(server: McpServer) {
  server.registerTool(
    "check_security",
    {
      title: "VPN/Proxy/Threat Detection",
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      description: `Read-only security lookup via GET /v3/security. Paid only. Cost: 2 credits. This endpoint is dedicated to security and threat data; lookup_ip with include=security provides security data together with location, ASN/company, network, timezone, currency, or abuse.

Returns { ip, security } with threat_score, VPN, proxy, residential proxy, Tor, relay, anonymity, bot, spam, known attacker, and cloud-provider fields; provider names, confidence scores, and last_seen dates appear when available.

fields/excludes accept comma-separated security.* dot paths; ip is always returned. Threat scores and flags are indicators, not a safety guarantee; missing or unknown data is inconclusive. This queries IP intelligence, not the separate live browser detection API. force_refresh bypasses cached data, makes a new upstream request, and can consume credits.`,
      inputSchema: {
        ip: z
          .string()
          .optional()
          .describe(
            "IPv4 or IPv6 address to check. Omit to check the server's public egress IP."
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
            "Default false. When true, bypasses cached security data; a successful refresh makes a new upstream request and can consume credits."
          ),
      },
    },

    async (params) => {
      try {
        const cacheKey = buildSecurityCacheKey(params.ip);
        const baseResult = await getCachedOrFetchValue(
          cacheKey,
          () => getSecurity({ ip: params.ip }),
          params.force_refresh
        );

        const result = applyFieldsAndExcludes(baseResult, {
          fields: params.fields,
          excludes: params.excludes,
          rootKey: "security",
          preserveIp: true,
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
        openWorldHint: true,
      },
      description: `Read-only bulk security lookup via POST /v3/security-bulk. Paid only. Cost: 2 credits per valid IP. This MCP server accepts up to ${MAX_BULK_ITEMS.toLocaleString()} IPs; private, bogon, and malformed IPs are not billed. Larger batches are rejected before any API call. Complete results are returned directly or as cached pages. Oversized results contain page.next_cursor for complete retrieval through get_cached_result without another API call or additional credits.

This endpoint is dedicated to security-only batches; bulk_lookup_ip with include=security provides security data together with geolocation or other IP domains. Returns one { ip, security } result per valid IP. fields/excludes accept security.* dot paths per item. force_refresh bypasses cached data, makes a new upstream request, and can consume credits.`,
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
            "Default false. When true, bypasses cached bulk security data; a successful refresh makes a new upstream request and can consume credits."
          ),
      },
    },
    async (params) => {
      try {
        const cacheKey = buildSecurityBulkCacheKey(params);
        const result = await getCachedOrFetchValue(
          cacheKey,
          () => getSecurityBulk(params),
          params.force_refresh
        );

        return {
          content: [
            { type: "text" as const, text: formatBulkToolResult(result) },
          ],
        };
      } catch (error) {
        return errorToolResponse(error);
      }
    }
  );
}
