import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getIpGeolocation, getIpGeolocationBulk, getMyIp } from "../client.js";
import {
  MAX_BULK_ITEMS,
  errorToolResponse,
  formatToolResult,
} from "./response.js";
import { getCachedValue, setCachedValue } from "./cache.js";
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

const LOOKUP_IP_INCLUDE_TOKEN_MAP: Record<string, string> = {
  security: "security",
  abuse: "abuse",
  hostname: "hostname",
  livehostname: "liveHostname",
  hostnamefallbacklive: "hostnameFallbackLive",
  user_agent: "user_agent",
  geo_accuracy: "geo_accuracy",
  dma_code: "dma_code",
  "*": "*",
};

function canonicalizeLookupIpIncludeToken(token: string): string {
  const normalized = token.trim().toLowerCase();
  return LOOKUP_IP_INCLUDE_TOKEN_MAP[normalized] ?? token.trim();
}

function inferLookupIpIncludeFromFields(fields: string | undefined): string[] {
  const inferred = new Set<string>();

  for (const path of splitCsv(fields)) {
    const firstSegment = path.split(".")[0]?.trim().toLowerCase() ?? "";
    const mapped = LOOKUP_IP_INCLUDE_TOKEN_MAP[firstSegment];
    if (mapped) {
      inferred.add(mapped);
    }
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
  const normalizedIp = ip?.trim().toLowerCase() ?? "self";
  const normalizedLang = lang?.trim().toLowerCase() ?? "";
  return `ipgeo|ip=${normalizedIp}|lang=${normalizedLang}|include=`;
}

function buildIpGeoIncludeCacheKey(params: {
  ip?: string;
  lang?: string;
  include: string;
  fields?: string;
  excludes?: string;
}): string {
  const normalizedIp = params.ip?.trim().toLowerCase() ?? "self";
  const normalizedLang = params.lang?.trim().toLowerCase() ?? "";
  const normalizedInclude = normalizeLookupIpInclude(params.include) ?? "";
  const normalizedFields = normalizeCsvForCacheKey(params.fields);
  const normalizedExcludes = normalizeCsvForCacheKey(params.excludes);
  return `ipgeo|ip=${normalizedIp}|lang=${normalizedLang}|include=${normalizedInclude}|fields=${normalizedFields}|excludes=${normalizedExcludes}`;
}

function buildBulkIpGeoCacheKey(params: {
  ips: string[];
  lang?: string;
  include?: string;
  fields?: string;
  excludes?: string;
}): string {
  const normalizedIps = params.ips
    .map((ip) => ip.trim().toLowerCase())
    .join(",");
  const normalizedLang = params.lang?.trim().toLowerCase() ?? "";
  const normalizedInclude = normalizeLookupIpInclude(params.include) ?? "";
  const normalizedFields = normalizeCsvForCacheKey(params.fields);
  const normalizedExcludes = normalizeCsvForCacheKey(params.excludes);
  return `ipgeo-bulk|ips=${normalizedIps}|lang=${normalizedLang}|include=${normalizedInclude}|fields=${normalizedFields}|excludes=${normalizedExcludes}`;
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
  if (!params.forceRefresh) {
    const cached = getCachedValue(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
  }

  const baseResult = await getIpGeolocation({
    ip: params.ip,
    lang: params.lang,
  });
  setCachedValue(cacheKey, baseResult);
  return baseResult;
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

  if (!params.forceRefresh) {
    const cached = getCachedValue(requestKey);
    if (cached !== undefined) {
      return cached;
    }

    if (projectionRequested) {
      const includeBaseCached = getCachedValue(includeBaseKey);
      if (includeBaseCached !== undefined) {
        const projected = applyFieldsAndExcludes(includeBaseCached, {
          fields: params.fields,
          excludes: params.excludes,
        });
        setCachedValue(requestKey, projected);
        return projected;
      }
    }
  }

  const result = await getIpGeolocation({
    ip: params.ip,
    lang: params.lang,
    include: normalizedInclude,
    fields: params.fields,
    excludes: params.excludes,
  });
  setCachedValue(requestKey, result);

  if (!projectionRequested) {
    setCachedValue(includeBaseKey, result);
  }

  return result;
}

export function registerGeolocationTools(server: McpServer) {
  server.registerTool(
    "lookup_ip",
    {
      title: "IP Geolocation Lookup",
      annotations: {
        readOnlyHint: true,
      },
      description: `Read-only unified IP lookup via GET /v3/ipgeo. Base lookup costs 1 credit; include=security adds 2 credits and include=abuse adds 1 credit. Use this first when one IP or domain needs multiple data domains: location, company/ASN, network, timezone, currency, security, abuse, user_agent, hostname, geo_accuracy, or dma_code.

Returns root IP/domain data plus selected objects such as location, country_metadata, currency, asn, network, company, time_zone, security, abuse, user_agent, hostname, geo_accuracy, or dma_code. Free plans support core location, country_metadata, currency, time_zone, basic ASN, fields, and excludes; paid plans add domain lookup, company, network, extended ASN, non-English lang, and include modules.

ip omitted means caller IP. fields/excludes use comma-separated dot paths; ip is always returned, unknown excludes do not error, and include wins over fields/excludes. This server auto-adds include modules referenced by fields. Use lookup_asn only for peers, upstreams, downstreams, routes, or WHOIS; use check_security or get_abuse_contact only for security-only or abuse-only requests.`,
      inputSchema: {
        ip: z
          .string()
          .optional()
          .describe(
            "IPv4 address, IPv6 address, or domain name to look up. Domain lookups require a paid plan. Omit to use the caller's IP."
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
            "Comma-separated dot-path fields to return (e.g. location.city,asn.organization). Works on all plans including free. Reduces response size and can reduce credit cost when combined with include. If a field references an include-only module (for example security.* or abuse.*), this server auto-adds the required include module."
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
            "Default false. Set true only when the user asks to bypass cached lookup_ip data; a successful refresh makes a new upstream request and can consume credits."
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
          result = applyFieldsAndExcludes(baseResult, {
            fields: params.fields,
            excludes: params.excludes,
          });
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
      },
      description: `Read-only bulk IP lookup via POST /v3/ipgeo-bulk. Paid only. Base geolocation costs 1 credit per valid IP; security adds 2 and abuse adds 1 per valid IP. This MCP server accepts up to ${MAX_BULK_ITEMS.toLocaleString()} IPs per request.

Use when multiple IPs or domains need location data or mixed IP domains. Private, bogon, and malformed IPs are not billed. fields, excludes, lang, and include behave like lookup_ip for each item; this server also infers include modules from fields. For security-only batches, use bulk_security_check.`,
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
            "Comma-separated dot-path fields to return per IP (e.g. location.city,asn.organization). Reduces response size and can reduce credit cost when combined with include. If fields reference include-only modules (for example security.* or abuse.*), this server auto-adds required include modules."
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
            "Default false. Set true only when the user asks to bypass cached bulk geolocation data; a successful refresh makes a new upstream request and can consume credits."
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
        const cached = params.force_refresh ? undefined : getCachedValue(cacheKey);

        const result =
          cached ??
          (await getIpGeolocationBulk({
            ...params,
            include: effectiveInclude,
          }));

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

  server.registerTool(
    "get_my_ip",
    {
      title: "Get My IP Address",
      annotations: {
        readOnlyHint: true,
      },
      description:
        "Return the public IP address of the machine running this MCP server via GET /v3/getip. Takes no input parameters and requires no API key, account, or credits. Returns a plain IP address string, not geolocation data. Use this only when the user asks for the server or caller public IP; use lookup_ip for location, ASN, timezone, currency, security, or abuse data.",
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
      },
      description: `Read-only ownership lookup via GET /v3/ipgeo. Paid only. Cost: 1 credit. Use only for company/ASN ownership; use lookup_ip once if the same IP request also needs location, security, abuse, network, timezone, or currency.

Returns { company, asn }: company name/type/domain plus ASN allocation fields when available. ip omitted means caller IP. force_refresh bypasses cache only when the user asks. Call once per IP target and post-process locally.`,
      inputSchema: {
        ip: z
          .string()
          .optional()
          .describe(
            "IPv4 or IPv6 address to look up. Omit to check the caller's IP."
          ),
        force_refresh: z
          .boolean()
          .optional()
          .describe(
            "Default false. Set true only when the user asks to refresh cached ownership data; a successful refresh makes a new upstream request and can consume credits."
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
      },
      description: `Read-only currency and country metadata lookup via GET /v3/ipgeo. Works on free and paid plans. Cost: 1 credit per successful lookup.

Returns { currency, country_metadata }: currency code/name/symbol plus country calling_code, tld, and languages. ip selects the IP used to derive country and currency; omit it for caller IP. force_refresh bypasses cache only when the user asks.

Use this tool for currency-only or country-metadata-only requests. If the request needs more IP data, prefer one lookup_ip call with targeted fields/excludes.`,
      inputSchema: {
        ip: z
          .string()
          .optional()
          .describe(
            "IPv4 or IPv6 address whose country determines the returned currency and country metadata. Omit to use the caller's IP."
          ),
        force_refresh: z
          .boolean()
          .optional()
          .describe(
            "Default false. Set true only when the user asks to refresh cached currency/country data; a successful refresh makes a new upstream request and can consume credits."
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
      },
      description: `Read-only network lookup via GET /v3/ipgeo. Paid only. Cost: 1 credit. Returns { network } with route CIDR prefix, connection_type, and is_anycast.

ip omitted means caller IP. force_refresh bypasses cache and makes a fresh upstream request only when the user asks. Use this for network-only requests; use lookup_ip once if the request also needs location, ASN/company, timezone, currency, security, or abuse.`,
      inputSchema: {
        ip: z
          .string()
          .optional()
          .describe(
            "IPv4 or IPv6 address to look up. Omit to check the caller's IP."
          ),
        force_refresh: z
          .boolean()
          .optional()
          .describe(
            "Default false. Set true only when the user asks to refresh cached network data; a successful refresh makes a new upstream request and can consume credits."
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
          fields: "network",
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
