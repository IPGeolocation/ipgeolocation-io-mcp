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

Get abuse contact information for any IP address using ipgeolocation.io's dedicated abuse endpoint (GET /v3/abuse). Paid plans only. Free plan returns 401 Unauthorized. Costs 1 credit per lookup.

Returns: route, country, name, organization, kind, address, emails (array), phone_numbers (array). Useful for reporting malicious activity to the correct network operator.

Note: abuse data is also available through lookup_ip with include=abuse, which costs 2 credits total (1 base + 1 for abuse) but also returns full geolocation data. If you only need the abuse contact without geolocation, this dedicated endpoint is cheaper at 1 credit. Tip: you can also use lookup_ip with include=abuse&fields=abuse to get just the abuse data for 1 credit total. The fields and excludes parameters work on all plans to filter the response.

Tool selection rule: if this tool is used, call it once per IP target and post-process locally. Do not re-call get_abuse_contact for the same IP just to change fields/excludes or to reformat output.`,
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
          .describe(
            "Set true to bypass MCP cache and force a new upstream API request."
          ),
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
