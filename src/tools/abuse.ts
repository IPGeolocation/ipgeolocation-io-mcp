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
      description: `Read-only abuse contact lookup via GET /v3/abuse. Paid only. Cost: 1 credit. Use only for abuse contact data; use lookup_ip with include=abuse when the same IP also needs location, security, ASN/company, timezone, network, or currency.

Returns { ip, abuse } with route, country, name, organization, kind, address, emails, and phone_numbers for reporting abuse.

fields/excludes use comma-separated abuse.* paths such as abuse.emails; ip is always returned. force_refresh bypasses cache and makes a fresh upstream request only when the user asks. Call once per IP target and post-process locally.`,
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
            "Comma-separated abuse fields to return (e.g. abuse.emails,abuse.organization). Reduces response size."
          ),
        excludes: z
          .string()
          .optional()
          .describe(
            "Comma-separated abuse fields to exclude from response (e.g. abuse.phone_numbers,abuse.address)."
          ),
        force_refresh: z
          .boolean()
          .optional()
          .describe(
            "Default false. Set true only when the user asks to refresh cached abuse contact data; a successful refresh makes a new upstream request and can consume credits."
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
