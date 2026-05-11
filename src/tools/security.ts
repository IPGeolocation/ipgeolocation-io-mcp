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
      description: `Read-only security lookup via GET /v3/security. Paid only. Cost: 2 credits. Use only for security/threat data; use lookup_ip with include=security when the same request also needs location, ASN/company, network, timezone, currency, or abuse.

Returns { ip, security } with threat_score, VPN, proxy, residential proxy, Tor, relay, anonymity, bot, spam, known attacker, and cloud-provider fields; provider names, confidence scores, and last_seen dates appear when available.

fields/excludes use comma-separated security.* dot paths; ip is always returned. force_refresh bypasses cache only when the user asks. Call once per IP target and post-process locally.`,
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
            "Default false. Set true only when the user asks to refresh cached security data; a successful refresh makes a new upstream request and can consume credits."
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
      description: `Read-only bulk security lookup via POST /v3/security-bulk. Paid only. Cost: 2 credits per valid IP. This MCP server accepts up to ${MAX_BULK_ITEMS.toLocaleString()} IPs; private, bogon, and malformed IPs are not billed.

Use for security-only batches; use bulk_lookup_ip with include=security when each IP also needs geolocation or other IP domains. Returns one { ip, security } result per valid IP. fields/excludes use security.* dot paths per item. force_refresh bypasses cache only when the user asks.`,
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
            "Default false. Set true only when the user asks to refresh cached bulk security data; a successful refresh makes a new upstream request and can consume credits."
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
