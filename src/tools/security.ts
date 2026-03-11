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

Dedicated IP security lookup via GET /v3/security. Paid only. Cost: 2 credits. Returns threat score plus VPN, proxy, Tor, bot, spam, attacker, relay, anonymity, and cloud-provider indicators.

Use lookup_ip with include=security when the same request also needs other IP domains. Tool selection rule: if this tool is used, call it once per IP target and post-process locally. Do not re-call check_security for the same IP just to change fields/excludes or to reformat output.`,
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
          .describe("Default false. Leave unset unless the user asks to refresh or rerun."),
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

Bulk IP security lookup via POST /v3/security-bulk for up to ${MAX_BULK_ITEMS.toLocaleString()} IPs per MCP request. Paid only. Cost: 2 credits per valid IP.

Use bulk_lookup_ip with include=security when the same batch also needs geolocation or other IP domains. Tool selection rule: call this tool once per IP batch and post-process locally. Do not re-call bulk_security_check for the same batch only to change fields/excludes or output shape.`,
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
          .describe("Default false. Leave unset unless the user asks to refresh or rerun."),
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
