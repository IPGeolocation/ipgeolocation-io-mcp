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
      description: `Look up geolocation data for a single IP address or domain using ipgeolocation.io's unified endpoint (GET /v3/ipgeo). Costs 1 credit per request on all plans.

FREE PLAN returns: ip, location (continent, country, state, district, city, zipcode, latitude, longitude, is_eu, country_flag, country_emoji, geoname_id), country_metadata (calling_code, tld, languages), currency (code, name, symbol), time_zone (name, offset, DST info, current_time), and basic ASN (as_number, organization, country). The fields and excludes parameters work on the free plan. Domain lookups and the include parameter are not available on the free plan. The lang parameter returns a 401 error on the free plan for any language other than en.

PAID PLANS return everything above plus: network (connection_type, route, is_anycast), company (name, type, domain), and extended ASN (as_number, organization, country, type, domain, date_allocated, rir). The ASN object identifies the organization that holds the IP block allocation from a Regional Internet Registry (ARIN, RIPE, APNIC, etc.). The company object identifies the organization actually using the IP address. These are often the same, but differ when the ASN holder subleases IP space to another organization. For example, the ASN holder might be a cloud provider like Amazon while the company is a business running its infrastructure on that cloud. Paid plans also enable the include parameter to add extra modules: security (+2 credits, 3 total), abuse (+1 credit, 2 total), hostname (+0), liveHostname (+0), hostnameFallbackLive (+0), user_agent (+0), geo_accuracy (+0), dma_code (+0), or * for all (4 credits total). Paid plans support the lang parameter for non-English responses and can look up domains in addition to IPs. Tip: use include=security&fields=security to get only security data for 2 credits instead of 3.

If no IP is provided, returns data for the caller's IP. For basic ASN info on the free plan, use this tool. For detailed ASN data (peers, routes, WHOIS), use lookup_asn instead (paid only). For standalone security checks at 2 credits each, use check_security instead. For standalone abuse lookups at 1 credit, use get_abuse_contact instead.`,
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
            "Set true to bypass MCP cache and force a new upstream API request."
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
      description: `Look up geolocation data for multiple IP addresses in a single request using ipgeolocation.io's bulk endpoint (POST /v3/ipgeo-bulk). Accepts up to ${MAX_BULK_ITEMS.toLocaleString()} IPs per request through this MCP server (the raw API supports up to 50,000). Paid plans only. Free plan returns 401 Unauthorized.

Costs 1 credit per IP for base geolocation data. Each IP in the response contains the same fields as a single lookup_ip call on a paid plan: ip, location, country_metadata, currency, time_zone, network, company, and extended ASN (as_number, organization, country, type, domain, date_allocated, rir).

Optional include modules add credits per IP: security (+2 per IP), abuse (+1 per IP), hostname (+0), liveHostname (+0), hostnameFallbackLive (+0), user_agent (+0), geo_accuracy (+0), dma_code (+0), or * for all (4 credits per IP total).

Returns a JSON array with one geolocation object per IP. Use this tool when you need to look up more than one IP at a time. For a single IP lookup, use lookup_ip instead. For bulk security-only checks, use bulk_security_check instead (2 credits per IP).`,
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
            "Set true to bypass MCP cache and force a new upstream API request."
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
        "Get the public IP address of the machine running this MCP server. No API key required. No credits charged. Uses the /v3/getip endpoint. Useful for discovering the server's own IP before doing a geolocation lookup with lookup_ip.",
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
      description: `Decision policy: this is a single-domain tool. Use it only when the user asks for ownership data (company/ASN) only. If the same IP request also needs security, abuse, location/city, timezone, network, or currency data, call lookup_ip once with include and targeted fields/excludes instead of chaining tools.

Identify the organization using a specific IP address. Uses ipgeolocation.io's unified endpoint (GET /v3/ipgeo) with fields filtered to company and ASN data. Paid plans only. Free plan does not return company data. Costs 1 credit.

Returns two objects: company (name, type, domain) and asn (as_number, organization, country, type, domain, date_allocated, rir). The ASN object identifies the organization that holds the IP block allocation from a Regional Internet Registry (ARIN, RIPE, APNIC, etc.). The company object identifies the organization actually using the IP address. These are often the same, but differ when the ASN holder subleases IP space to another organization. For example, 1.1.1.1 has ASN organization "Cloudflare, Inc." (who routes it) but company "APNIC Research and Development" (who owns the block).

Use this tool when you need to know which company or organization is behind an IP address. For full geolocation data including company, use lookup_ip instead. For detailed ASN data (peers, routes, WHOIS), use lookup_asn instead.

Tool selection rule: if this tool is used, call it once per IP target and post-process locally. Do not re-call lookup_company for the same IP just to change output shape.`,
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
            "Set true to bypass MCP cache and force a new upstream API request."
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
      description: `Get the local currency and country metadata for any IP address. Uses ipgeolocation.io's unified endpoint (GET /v3/ipgeo) with fields filtered to currency and country_metadata. Works on all plans including free. Costs 1 credit.

Returns two objects: currency (code, name, symbol) and country_metadata (calling_code, tld, languages). For example, a Japanese IP returns currency {code: "JPY", name: "Japanese Yen", symbol: "¥"} and country_metadata {calling_code: "+81", tld: ".jp", languages: ["ja"]}.

Use this tool when you need to know the currency, international calling code, country TLD, or spoken languages for an IP's country. For full geolocation data, use lookup_ip instead.

Tool selection rule: use this tool for currency/country-metadata-only requests. If the request needs additional IP intelligence fields, prefer one lookup_ip call with targeted fields/excludes.`,
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
            "Set true to bypass MCP cache and force a new upstream API request."
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
      description: `Get network routing information for any IP address, including whether it uses anycast. Uses ipgeolocation.io's unified endpoint (GET /v3/ipgeo) with fields filtered to network data. Paid plans only. Free plan does not return network data. Costs 1 credit.

Returns: network (connection_type, route, is_anycast). The route field shows the announced BGP prefix (e.g. "1.1.1.0/24"). The is_anycast field indicates whether the IP is served from multiple geographic locations using anycast routing. The connection_type field identifies the type of network connection when available.

Use this tool when you need to check if an IP is anycast, find its BGP route prefix, or identify its connection type. For full geolocation data including network, use lookup_ip instead.

Tool selection rule: use this tool for network-only requests. If the request also needs other IP domains (security, company, location, timezone, abuse), prefer one lookup_ip call with include plus targeted fields/excludes.`,
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
            "Set true to bypass MCP cache and force a new upstream API request."
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
