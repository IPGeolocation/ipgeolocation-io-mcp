import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAstronomy, getAstronomyTimeSeries } from "../client.js";
import { errorToolResponse, formatToolResult } from "./response.js";
import { getCachedValue, setCachedValue } from "./cache.js";
import {
  validateCoordinatePair,
  validateDateRange,
  validateElevation,
  validateIsoDate,
} from "./validation.js";

function normalizeValue(value: string | undefined): string {
  return value?.trim() ?? "";
}

function buildAstronomyTimeSeriesCacheKey(params: {
  lat?: string;
  long?: string;
  location?: string;
  ip?: string;
  dateStart: string;
  dateEnd: string;
  elevation?: string;
  time_zone?: string;
  lang?: string;
}): string {
  return [
    "astronomy-series",
    `lat=${normalizeValue(params.lat)}`,
    `long=${normalizeValue(params.long)}`,
    `location=${normalizeValue(params.location)}`,
    `ip=${normalizeValue(params.ip)}`,
    `dateStart=${normalizeValue(params.dateStart)}`,
    `dateEnd=${normalizeValue(params.dateEnd)}`,
    `elevation=${normalizeValue(params.elevation)}`,
    `time_zone=${normalizeValue(params.time_zone)}`,
    `lang=${normalizeValue(params.lang)}`,
  ].join("|");
}

export function registerAstronomyTools(server: McpServer) {
  server.registerTool(
    "get_astronomy",
    {
      title: "Astronomy Data",
      annotations: {
        readOnlyHint: true,
      },
      description: `Astronomy lookup via GET /v3/astronomy. Works on free and paid plans. Cost: 1 credit. Look up by coordinates, location, or IP, with optional date and elevation.

Returns location details plus astronomy data such as sunrise, sunset, moonrise, moonset, morning and evening twilight blocks, day length, sun and moon status, positions, and moon phase fields.

The lang parameter for non-English location field responses is available on paid plans only. On free plans, using a non-English lang value returns 401 Unauthorized.`,
      inputSchema: {
        lat: z
          .string()
          .optional()
          .describe(
            "Latitude coordinate. Highest priority. Must be used with long."
          ),
        long: z
          .string()
          .optional()
          .describe("Longitude coordinate. Must be used with lat."),
        location: z
          .string()
          .optional()
          .describe("City or address string (e.g. San Francisco, CA)."),
        ip: z
          .string()
          .optional()
          .describe(
            "IPv4 or IPv6 address to get astronomy data for that IP's location."
          ),
        date: z
          .string()
          .optional()
          .describe("Date in YYYY-MM-DD format. Defaults to today."),
        elevation: z
          .string()
          .optional()
          .describe(
            "Elevation in meters above sea level (0-10000). Affects sunrise/sunset calculations for higher accuracy."
          ),
        time_zone: z
          .string()
          .optional()
          .describe(
            "IANA timezone name to express times in (e.g. America/New_York). If set, time fields include full date instead of just time."
          ),
        lang: z
          .string()
          .optional()
          .describe(
            "Response language for location fields in IP-based lookups (en, de, ru, ja, fr, cn, es, cs, it, ko, fa, pt). Paid plans only. Free plan returns 401 for non-English language values."
          ),
      },
    },

    async (params) => {
      try {
        const coordinateError = validateCoordinatePair(
          params.lat,
          params.long,
          "get_astronomy"
        );
        if (coordinateError) {
          throw new Error(coordinateError);
        }

        const dateError = validateIsoDate(params.date, "date");
        if (dateError) {
          throw new Error(dateError);
        }

        const elevationError = validateElevation(params.elevation, "elevation");
        if (elevationError) {
          throw new Error(elevationError);
        }

        const result = await getAstronomy({
          lat: params.lat,
          long: params.long,
          location: params.location,
          ip: params.ip,
          date: params.date,
          elevation: params.elevation,
          time_zone: params.time_zone,
          lang: params.lang,
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
    "get_astronomy_time_series",
    {
      title: "Astronomy Time Series",
      annotations: {
        readOnlyHint: true,
      },
      description: `Daily astronomy time series via GET /v3/astronomy/timeSeries for up to 90 days. Works on free and paid plans. Cost: 1 credit per request.

Returns location details plus an astronomy array with one daily entry per date. Use get_astronomy instead when you need real-time positional fields such as sun or moon altitude and azimuth.

Location can be specified by coordinates, city/address, or IP. If no location is given, uses the caller's IP.`,
      inputSchema: {
        lat: z
          .string()
          .optional()
          .describe(
            "Latitude coordinate. Highest priority. Must be used with long."
          ),
        long: z
          .string()
          .optional()
          .describe("Longitude coordinate. Must be used with lat."),
        location: z
          .string()
          .optional()
          .describe("City or address string (e.g. San Francisco, CA)."),
        ip: z
          .string()
          .optional()
          .describe(
            "IPv4 or IPv6 address to get astronomy data for that IP's location."
          ),
        dateStart: z
          .string()
          .describe(
            "Start date in YYYY-MM-DD format. Required. Maximum range between dateStart and dateEnd is 90 days."
          ),
        dateEnd: z
          .string()
          .describe(
            "End date in YYYY-MM-DD format. Required. Maximum range between dateStart and dateEnd is 90 days."
          ),
        elevation: z
          .string()
          .optional()
          .describe(
            "Elevation in meters above sea level (0-10000). Affects sunrise/sunset calculations."
          ),
        time_zone: z
          .string()
          .optional()
          .describe(
            "IANA timezone name to express times in (e.g. America/New_York). If set, time fields include full date instead of just time."
          ),
        lang: z
          .string()
          .optional()
          .describe(
            "Response language for location fields in IP-based lookups (en, de, ru, ja, fr, cn, es, cs, it, ko, fa, pt). Paid plans only. Free plan returns 401 for non-English languages."
          ),
        force_refresh: z
          .boolean()
          .optional()
          .describe("Bypass MCP cache and fetch fresh upstream data."),
      },
    },
    async (params) => {
      try {
        const coordinateError = validateCoordinatePair(
          params.lat,
          params.long,
          "get_astronomy_time_series"
        );
        if (coordinateError) {
          throw new Error(coordinateError);
        }

        const dateRangeError = validateDateRange(
          params.dateStart,
          params.dateEnd,
          90
        );
        if (dateRangeError) {
          throw new Error(dateRangeError);
        }

        const elevationError = validateElevation(params.elevation, "elevation");
        if (elevationError) {
          throw new Error(elevationError);
        }

        const cacheKey = buildAstronomyTimeSeriesCacheKey(params);
        const cached = params.force_refresh ? undefined : getCachedValue(cacheKey);
        const result =
          cached ??
          (await getAstronomyTimeSeries({
            lat: params.lat,
            long: params.long,
            location: params.location,
            ip: params.ip,
            dateStart: params.dateStart,
            dateEnd: params.dateEnd,
            elevation: params.elevation,
            time_zone: params.time_zone,
            lang: params.lang,
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
}
