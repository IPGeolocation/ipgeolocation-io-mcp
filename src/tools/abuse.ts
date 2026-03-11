import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAbuseContact } from "../client.js";
import { errorToolResponse, formatToolResult } from "./response.js";
import { getCachedValue, setCachedValue } from "./cache.js";
import { applyFieldsAndExcludes } from "./projection.js";

function buildAbuseCacheKey(ip: string | undefined): string {
  return `abuse|ip=${ip?.trim().toLowerCase() ?? "self"}`;
}

export function registerAbuseTools(server: McpServer) {
  server.registerTool(
    "get_abuse_contact",
    {
      title: "Abuse Contact Lookup",
      annotations: {
        readOnlyHint: true,
      },
      description: `Decision policy: this is a single-domain tool. Use it only when the user asks for abuse contact data only. If the same IP request also needs security, ownership/company/ASN, location/city, timezone, network, or currency data, call lookup_ip once with include and targeted fields/excludes instead of chaining tools.

Dedicated abuse lookup via GET /v3/abuse. Paid only. Cost: 1 credit. Returns route, country, organization, address, emails, and phone numbers for reporting abuse.

Use lookup_ip with include=abuse when the same request also needs geolocation or other IP domains. Tool selection rule: if this tool is used, call it once per IP target and post-process locally. Do not re-call get_abuse_contact for the same IP just to change fields/excludes or to reformat output.`,
      inputSchema: {
        ip: z
          .string()
          .optional()
          .describe(
            "IPv4 or IPv6 address to get abuse contact for. Omit to use the caller's IP."
          ),
        fields: z
          .string()
          .optional()
          .describe(
            "Comma-separated fields to return (e.g. emails,organization). Reduces response size. Works on all plans."
          ),
        excludes: z
          .string()
          .optional()
          .describe(
            "Comma-separated fields to exclude from response (e.g. phone_numbers,address)."
          ),
        force_refresh: z
          .boolean()
          .optional()
          .describe("Default false. Leave unset unless the user asks to refresh or rerun."),
      },
    },
    async (params) => {
      try {
        const cacheKey = buildAbuseCacheKey(params.ip);
        const cached = params.force_refresh ? undefined : getCachedValue(cacheKey);

        const baseResult =
          cached ??
          (await getAbuseContact({
            ip: params.ip,
          }));

        if (cached === undefined) {
          setCachedValue(cacheKey, baseResult);
        }

        const result = applyFieldsAndExcludes(baseResult, {
          fields: params.fields,
          excludes: params.excludes,
          rootKey: "abuse",
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
}
