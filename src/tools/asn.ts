import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAsn } from "../client.js";
import { errorToolResponse, formatToolResult } from "./response.js";
import { getCachedValue, setCachedValue } from "./cache.js";
import { applyFieldsAndExcludes } from "./projection.js";

function normalizeInclude(include: string | undefined): string {
  if (!include) {
    return "";
  }
  const normalized = include
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== "");
  return [...new Set(normalized)].sort().join(",");
}

function splitCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

const ASN_INCLUDE_SET = new Set([
  "peers",
  "downstreams",
  "upstreams",
  "routes",
  "whois_response",
]);

function inferAsnIncludeFromProjection(
  fields: string | undefined,
  excludes: string | undefined
): string {
  const inferred = new Set<string>();

  for (const path of [...splitCsv(fields), ...splitCsv(excludes)]) {
    const normalized = path.trim().toLowerCase();
    const withoutPrefix = normalized.startsWith("asn.")
      ? normalized.slice(4)
      : normalized;
    const firstSegment = withoutPrefix.split(".")[0];

    if (ASN_INCLUDE_SET.has(firstSegment)) {
      inferred.add(firstSegment);
    }
  }

  return [...inferred].sort().join(",");
}

function buildEffectiveAsnInclude(params: {
  include?: string;
  fields?: string;
  excludes?: string;
}): string {
  const explicit = normalizeInclude(params.include);
  const inferred = inferAsnIncludeFromProjection(params.fields, params.excludes);

  if (!explicit) {
    return inferred;
  }
  if (!inferred) {
    return explicit;
  }

  return normalizeInclude(`${explicit},${inferred}`);
}

function buildAsnCacheKey(params: {
  asn?: string;
  ip?: string;
  include?: string;
}): string {
  const asn = params.asn?.trim().toUpperCase() ?? "";
  const ip = params.ip?.trim().toLowerCase() ?? "";
  const include = normalizeInclude(params.include);
  return `asn|asn=${asn}|ip=${ip}|include=${include}`;
}

export function registerAsnTools(server: McpServer) {
  server.registerTool(
    "lookup_asn",
    {
      title: "ASN Details",
      annotations: {
        readOnlyHint: true,
      },
      description: `Read-only ASN enrichment via GET /v3/asn. Paid only. Cost: 1 credit. Query by asn or ip; asn takes priority over ip. Use for ASN relationships, route prefixes, allocation details, or WHOIS; use lookup_ip for basic ASN with geolocation.

Returns { asn } core fields plus included peers, downstreams, upstreams, routes, or whois_response. include accepts those five values. fields/excludes accept full asn.* paths or root-relative paths such as upstreams.as_number. force_refresh bypasses cache only when the user asks.`,
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
            "Comma-separated dot-path fields to return (e.g. asn.as_number,asn.organization or upstreams.as_number). Paths can be full (asn.upstreams.as_number) or relative to the asn root (upstreams.as_number). Use include for optional datasets (peers/downstreams/upstreams/routes/whois_response), then use fields to keep only required paths."
          ),
        excludes: z
          .string()
          .optional()
          .describe(
            "Comma-separated dot-path fields to exclude (e.g. asn.date_allocated,asn.rir or upstreams.description). Paths can be full or relative to the asn root."
          ),
        force_refresh: z
          .boolean()
          .optional()
          .describe(
            "Default false. Set true only when the user asks to refresh cached ASN data; a successful refresh makes a new upstream request and can consume credits."
          ),
      },
    },
    async (params) => {
      try {
        const effectiveInclude = buildEffectiveAsnInclude(params);
        const cacheKey = buildAsnCacheKey({
          ...params,
          include: effectiveInclude,
        });
        const cached = params.force_refresh ? undefined : getCachedValue(cacheKey);

        const baseResult =
          cached ??
          (await getAsn({
            asn: params.asn,
            ip: params.ip,
            include: effectiveInclude || undefined,
          }));

        if (cached === undefined) {
          setCachedValue(cacheKey, baseResult);
        }

        const result = applyFieldsAndExcludes(baseResult, {
          fields: params.fields,
          excludes: params.excludes,
          rootKey: "asn",
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
