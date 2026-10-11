import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getIpGeolocation, getIpGeolocationBulk, getMyIp } from "../client.js";
import {
  MAX_BULK_ITEMS,
  errorToolResponse,
  formatBulkToolResult,
  formatToolResult,
} from "./response.js";
import { getCachedOrFetchValue, getCachedValue } from "./cache.js";
import { applyFieldsAndExcludes } from "./projection.js";

function splitCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

function normalizeCsvForCacheKey(value: string | undefined): string {
  return splitCsv(value).sort().join(",");
}

const LOOKUP_IP_INCLUDE_TOKEN_MAP = new Map<string, string>([
  ["security", "security"],
  ["abuse", "abuse"],
  ["hostname", "hostname"],
  ["livehostname", "liveHostname"],
  ["hostnamefallbacklive", "hostnameFallbackLive"],
  ["user_agent", "user_agent"],
  ["geo_accuracy", "geo_accuracy"],
  ["dma_code", "dma_code"],
  ["*", "*"],
]);

function canonicalizeLookupIpIncludeToken(token: string): string {
  const normalized = token.trim().toLowerCase();
  return LOOKUP_IP_INCLUDE_TOKEN_MAP.get(normalized) ?? token.trim();
}

function inferLookupIpIncludeFromFields(fields: string | undefined): string[] {
  const inferred = new Set<string>();

  for (const path of splitCsv(fields)) {
    const firstSegment = path.split(".")[0]?.trim().toLowerCase() ?? "";
    const mapped = LOOKUP_IP_INCLUDE_TOKEN_MAP.get(firstSegment);
    if (mapped) {
      inferred.add(mapped);
    }
    if (["location.accuracy_radius", "location.confidence", "location.locality"].includes(path)) inferred.add("geo_accuracy");
    if (path === "location.dma_code") inferred.add("dma_code");
  }

  return [...inferred];
}

function normalizeLookupIpInclude(include: string | undefined): string | undefined {
  const tokens = splitCsv(include).map(canonicalizeLookupIpIncludeToken);
  if (tokens.length === 0) {
    return undefined;
  }

  const normalized = new Set(tokens.filter((token) => token !== ""));
  if (normalized.has("*")) {
    return "*";
  }

  return [...normalized].sort().join(",");
}

function mergeLookupIpInclude(
  include: string | undefined,
  fields: string | undefined
): string | undefined {
  const explicit = splitCsv(include).map(canonicalizeLookupIpIncludeToken);
  const inferred = inferLookupIpIncludeFromFields(fields);
  return normalizeLookupIpInclude([...explicit, ...inferred].join(","));
}

function buildIpGeoBaseCacheKey(ip: string | undefined, lang: string | undefined): string {
  const normalizedIp = ip?.trim().toLowerCase() ?? null;
  const normalizedLang = lang?.trim().toLowerCase() ?? "";
  return `ipgeo|${JSON.stringify([normalizedIp, normalizedLang])}`;
}

function buildIpGeoIncludeCacheKey(params: {
  ip?: string;
  lang?: string;
  include: string;
  fields?: string;
  excludes?: string;
}): string {
  const normalizedIp = params.ip?.trim().toLowerCase() ?? null;
  const normalizedLang = params.lang?.trim().toLowerCase() ?? "";
  const normalizedInclude = normalizeLookupIpInclude(params.include) ?? "";
  const normalizedFields = normalizeCsvForCacheKey(params.fields);
  const normalizedExcludes = normalizeCsvForCacheKey(params.excludes);
  return `ipgeo-include|${JSON.stringify([normalizedIp, normalizedLang, normalizedInclude, normalizedFields, normalizedExcludes])}`;
}

function buildBulkIpGeoCacheKey(params: {
  ips: string[];
  lang?: string;
  include?: string;
  fields?: string;
  excludes?: string;
}): string {
  const normalizedIps = params.ips.map((ip) => ip.trim().toLowerCase());
  const normalizedLang = params.lang?.trim().toLowerCase() ?? "";
  const normalizedInclude = normalizeLookupIpInclude(params.include) ?? "";
  const normalizedFields = normalizeCsvForCacheKey(params.fields);
  const normalizedExcludes = normalizeCsvForCacheKey(params.excludes);
  return `ipgeo-bulk|${JSON.stringify([normalizedIps, normalizedLang, normalizedInclude, normalizedFields, normalizedExcludes])}`;
}

const INCLUDE_RESPONSE_PATHS: Record<string, string[]> = {
  security: ["security"], abuse: ["abuse"], user_agent: ["user_agent"],
  hostname: ["hostname"], liveHostname: ["hostname"], hostnameFallbackLive: ["hostname"],
  geo_accuracy: ["location.accuracy_radius", "location.confidence", "location.locality"],
  dma_code: ["location.dma_code"],
};

function projectIncludedIpGeo(source: unknown, params: { include: string; fields?: string; excludes?: string }): unknown {
  const tokens = splitCsv(params.include);
  const groups = tokens.flatMap(token => Object.hasOwn(INCLUDE_RESPONSE_PATHS, token) ? [INCLUDE_RESPONSE_PATHS[token]] : []);
  const fields = splitCsv(params.fields);
  const extraFields = groups.flatMap(paths => fields.some(field => paths.some(path =>
    field === path || field.startsWith(`${path}.`) || path.startsWith(`${field}.`))) ? [] : paths);
  const protectedRoots = new Set([...groups.flat(), ...fields].map(path => path.split(".")[0]));
  return applyFieldsAndExcludes(source, {
    fields: fields.length > 0 ? [...fields, ...extraFields].join(",") : undefined,
    excludes: splitCsv(params.excludes).filter(path => !protectedRoots.has(path)).join(","),
    preserveIp: true,
  });
}

function hasProjection(fields: string | undefined, excludes: string | undefined): boolean {
  return splitCsv(fields).length > 0 || splitCsv(excludes).length > 0;
}

async function getCachedOrFetchIpGeoBase(params: {
  ip?: string;
  lang?: string;
  forceRefresh?: boolean;
}): Promise<unknown> {
  const cacheKey = buildIpGeoBaseCacheKey(params.ip, params.lang);
  return getCachedOrFetchValue(
    cacheKey,
    () => getIpGeolocation({ ip: params.ip, lang: params.lang }),
    params.forceRefresh
  );
}

async function getCachedOrFetchIpGeoInclude(params: {
  ip?: string;
  lang?: string;
  include: string;
  fields?: string;
  excludes?: string;
  forceRefresh?: boolean;
}): Promise<unknown> {
  const normalizedInclude = normalizeLookupIpInclude(params.include);
  if (!normalizedInclude) {
    return getCachedOrFetchIpGeoBase({
      ip: params.ip,
      lang: params.lang,
      forceRefresh: params.forceRefresh,
    });
  }

  const requestKey = buildIpGeoIncludeCacheKey({
    ip: params.ip,
    lang: params.lang,
    include: normalizedInclude,
    fields: params.fields,
    excludes: params.excludes,
  });
  const includeBaseKey = buildIpGeoIncludeCacheKey({
    ip: params.ip,
    lang: params.lang,
    include: normalizedInclude,
  });
  const projectionRequested = hasProjection(params.fields, params.excludes);

  return getCachedOrFetchValue(
    requestKey,
    async () => {
      if (!params.forceRefresh && projectionRequested) {
        const includeBaseCached = getCachedValue(includeBaseKey);
        if (includeBaseCached !== undefined) {
          return projectIncludedIpGeo(includeBaseCached, { ...params, include: normalizedInclude });
        }
      }

      return getIpGeolocation({
        ip: params.ip,
        lang: params.lang,
        include: normalizedInclude,
        fields: params.fields,
        excludes: params.excludes,
      });
    },
    params.forceRefresh
  );
}

export function registerGeolocationTools(server: McpServer) {
  server.registerTool(
    "lookup_ip",
    {
      title: "IP Geolocation Lookup",
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      description: `Read-only unified IP lookup via GET /v3/ipgeo. Base IP data costs 1 credit; security adds 2 and abuse adds 1. Selecting only security costs 2, only abuse costs 1, and security plus abuse without base data costs 3 credits. The unified response can cover multiple data domains for one IP or domain: location, company/ASN, network, timezone, currency, security, abuse, user_agent, hostname, geo_accuracy, and dma_code.

Returns root IP/domain data plus selected objects such as location, country_metadata, currency, asn, network, company, time_zone, security, abuse, user_agent, or hostname. geo_accuracy adds location.accuracy_radius, location.confidence, and location.locality; dma_code adds location.dma_code. Free plans support core location, country_metadata, currency, time_zone, basic ASN, fields, and excludes; paid plans add domain lookup, company, network, extended ASN, non-English lang, and include modules.

ip omitted means the server's public egress IP. IP location is an estimate, not a precise device position. fields/excludes accept comma-separated dot paths; ip is always returned and unknown excludes do not error. Explicit include tokens keep their modules even when fields omits them; fields can select their nested paths and excludes can remove nested paths. A root named by fields or an explicit include cannot be excluded as a whole. include=* follows fields/excludes without this explicit-token protection. This server auto-adds include modules referenced by fields, including optional location fields. lookup_asn provides ASN relationships, routes, and WHOIS; check_security and get_abuse_contact provide dedicated security and abuse responses.`,
      inputSchema: {
        ip: z
          .string()
          .optional()
          .describe(
            "IPv4 address, IPv6 address, or domain name to look up. Domain lookups require a paid plan. Omit to use the server's public egress IP."
          ),
        lang: z
          .string()
          .optional()
          .describe(
            "Response language code (en, de, ru, ja, fr, cn, es, cs, it, ko, fa, pt). Paid plans only. Free plan returns a 401 error if you pass any value other than en. Defaults to en."
          ),
        include: z
          .string()
          .optional()
          .describe(
            "Comma-separated extra modules to include in the response. Paid plans only. Options: security (+2 credits), abuse (+1 credit), hostname, liveHostname, hostnameFallbackLive, user_agent, geo_accuracy, dma_code, or * for all (4 credits total). Free plan cannot use this parameter."
          ),
        fields: z
          .string()
          .optional()
          .describe(
            "Comma-separated dot-path fields to return (e.g. location.city,asn.organization). Works on all plans including free. Reduces response size and can reduce credit cost when combined with include. Fields under security or abuse auto-add that include module. location.accuracy_radius/confidence/locality auto-add geo_accuracy; location.dma_code auto-adds dma_code. Those optional modules require a paid plan."
          ),
        excludes: z
          .string()
          .optional()
          .describe(
            "Comma-separated dot-path fields to exclude from response (e.g. currency,location.continent_code). Works on all plans including free."
          ),
        force_refresh: z
          .boolean()
          .optional()
          .describe(
            "Default false. When true, bypasses cached lookup_ip data; a successful refresh makes a new upstream request and can consume credits."
          ),
      },
    },
    async (params) => {
      try {
        const effectiveInclude = mergeLookupIpInclude(
          params.include,
          params.fields
        );
        let result: unknown;

        if (effectiveInclude) {
          result = await getCachedOrFetchIpGeoInclude({
            include: effectiveInclude,
            ip: params.ip,
            lang: params.lang,
            fields: params.fields,
            excludes: params.excludes,
            forceRefresh: params.force_refresh,
          });
        } else {
          const baseResult = await getCachedOrFetchIpGeoBase({
            ip: params.ip,
            lang: params.lang,
            forceRefresh: params.force_refresh,
          });
          result = projectIncludedIpGeo(baseResult, { ...params, include: "" });
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

  server.registerTool(
    "bulk_lookup_ip",
    {
      title: "Bulk IP Geolocation",
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      description: `Read-only bulk IP lookup via POST /v3/ipgeo-bulk. Documented as paid-only; the upstream API determines plan access. Base IP data costs 1 credit per valid IP; security adds 2 and abuse adds 1. Selecting only security costs 2, only abuse costs 1, and security plus abuse without base data costs 3 per valid IP. This MCP server accepts up to ${MAX_BULK_ITEMS.toLocaleString()} IPs per request. Larger batches are rejected before any API call. Complete results are returned directly or as cached pages. Oversized results contain page.next_cursor for complete retrieval through get_cached_result without another API call or additional credits.

The response covers location data or mixed IP data domains for multiple IPs or domains. Private, bogon, and malformed IPs are not billed. fields, excludes, lang, and include behave like lookup_ip for each item; this server also infers include modules from fields. bulk_security_check provides dedicated security-only batch responses.`,
      inputSchema: {
        ips: z
          .array(z.string())
          .min(1)
          .max(MAX_BULK_ITEMS)
          .describe(
            `Array of IPv4 and/or IPv6 addresses to look up. Minimum 1, maximum ${MAX_BULK_ITEMS.toLocaleString()} in this MCP server. Domain names are also accepted.`
          ),
        lang: z
          .string()
          .optional()
          .describe(
            "Response language code (en, de, ru, ja, fr, cn, es, cs, it, ko, fa, pt). Defaults to en."
          ),
        include: z
          .string()
          .optional()
          .describe(
            "Comma-separated extra modules to include per IP. Options: security (+2 credits/IP), abuse (+1 credit/IP), hostname, liveHostname, hostnameFallbackLive, user_agent, geo_accuracy, dma_code, or * for all (4 credits/IP total)."
          ),
        fields: z
          .string()
          .optional()
          .describe(
            "Comma-separated dot-path fields to return per IP (e.g. location.city,asn.organization). Reduces response size and can reduce credit cost when combined with include. Fields under security or abuse auto-add that module. location.accuracy_radius/confidence/locality auto-add geo_accuracy; location.dma_code auto-adds dma_code. Optional modules require a paid plan."
          ),
        excludes: z
          .string()
          .optional()
          .describe(
            "Comma-separated dot-path fields to exclude per IP (e.g. currency,time_zone)."
          ),
        force_refresh: z
          .boolean()
          .optional()
          .describe(
            "Default false. When true, bypasses cached bulk geolocation data; a successful refresh makes a new upstream request and can consume credits."
          ),
      },
    },
    async (params) => {
      try {
        const effectiveInclude = mergeLookupIpInclude(
          params.include,
          params.fields
        );
        const cacheKey = buildBulkIpGeoCacheKey({
          ips: params.ips,
          lang: params.lang,
          include: effectiveInclude,
          fields: params.fields,
          excludes: params.excludes,
        });
        const result = await getCachedOrFetchValue(
          cacheKey,
          () => getIpGeolocationBulk({
            ...params,
            include: effectiveInclude,
          }),
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

  server.registerTool(
    "get_my_ip",
    {
      title: "Get My IP Address",
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      description:
        "Returns the public IP address of the machine running this MCP server via GET /v3/getip. Takes no input parameters and requires no API key, account, or credits. The response is a plain IP address string, not geolocation data; lookup_ip provides location, ASN, timezone, currency, security, and abuse data.",
      inputSchema: {},
    },
    async () => {
      try {
        const ip = await getMyIp();
        return {
          content: [{ type: "text" as const, text: ip }],
        };
      } catch (error) {
        return errorToolResponse(error);
      }
    }
  );

  server.registerTool(
    "lookup_company",
    {
      title: "Company/Organization Lookup",
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      description: `Read-only ownership lookup via GET /v3/ipgeo. Company details require a paid plan; free plans return basic ASN ownership only. Cost: 1 credit. This response is limited to company and ASN ownership; lookup_ip can return ownership together with location, security, abuse, network, timezone, or currency.

Returns { company, asn }: company name/type/domain plus ASN allocation fields when available. ip omitted means the server's public egress IP. force_refresh bypasses cached data, makes a new upstream request, and can consume credits.`,
      inputSchema: {
        ip: z
          .string()
          .optional()
          .describe(
            "IPv4 or IPv6 address to look up. Omit to check the server's public egress IP."
          ),
        force_refresh: z
          .boolean()
          .optional()
          .describe(
            "Default false. When true, bypasses cached ownership data; a successful refresh makes a new upstream request and can consume credits."
          ),
      },
    },
    async (params) => {
      try {
        const baseResult = await getCachedOrFetchIpGeoBase({
          ip: params.ip,
          forceRefresh: params.force_refresh,
        });

        const result = applyFieldsAndExcludes(baseResult, {
          fields: "company,asn",
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
    "lookup_currency",
    {
      title: "Currency and Country Metadata",
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      description: `Read-only currency and country metadata lookup via GET /v3/ipgeo. Works on free and paid plans. Cost: 1 credit per successful lookup.

Returns { currency, country_metadata }: currency code/name/symbol plus country calling_code, tld, and languages. ip selects the IP used to derive country and currency; omit it for the server machine's public egress IP. force_refresh bypasses cached data, makes a new upstream request, and can consume credits.

This response is limited to currency and country metadata. lookup_ip can return these fields together with other IP data.`,
      inputSchema: {
        ip: z
          .string()
          .optional()
          .describe(
            "IPv4 or IPv6 address whose country determines the returned currency and country metadata. Omit to use the server's public egress IP."
          ),
        force_refresh: z
          .boolean()
          .optional()
          .describe(
            "Default false. When true, bypasses cached currency/country data; a successful refresh makes a new upstream request and can consume credits."
          ),
      },
    },
    async (params) => {
      try {
        const baseResult = await getCachedOrFetchIpGeoBase({
          ip: params.ip,
          forceRefresh: params.force_refresh,
        });

        const result = applyFieldsAndExcludes(baseResult, {
          fields: "currency,country_metadata",
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
    "lookup_network",
    {
      title: "Network/Routing Info",
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      description: `Read-only network lookup via GET /v3/ipgeo. Network details require a paid plan. Cost: 1 credit. Returns { network } with route CIDR prefix, connection_type, and is_anycast. If the API omits network data, returns a local error without inventing an HTTP status; credits may already have been used.

ip omitted means the server's public egress IP. force_refresh bypasses cached data, makes a new upstream request, and can consume credits. This response is limited to network data; lookup_ip can return network data together with location, ASN/company, timezone, currency, security, or abuse.`,
      inputSchema: {
        ip: z
          .string()
          .optional()
          .describe(
            "IPv4 or IPv6 address to look up. Omit to check the server's public egress IP."
          ),
        force_refresh: z
          .boolean()
          .optional()
          .describe(
            "Default false. When true, bypasses cached network data; a successful refresh makes a new upstream request and can consume credits."
          ),
      },
    },
    async (params) => {
      try {
        const baseResult = await getCachedOrFetchIpGeoBase({
          ip: params.ip,
          forceRefresh: params.force_refresh,
        });

        if (!baseResult || typeof baseResult !== "object" || !("network" in baseResult) || baseResult.network == null) {
          throw new Error("Network data is unavailable in the API response. Network details require a paid plan; verify plan access and this IP before retrying. API credits may already have been used.");
        }
        const result = applyFieldsAndExcludes(baseResult, { fields: "network" });

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
