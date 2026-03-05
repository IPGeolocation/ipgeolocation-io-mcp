import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAstronomy, getAstronomyTimeSeries } from "../client.js";
import { errorToolResponse, formatToolResult } from "./response.js";
import {
  validateCoordinatePair,
  validateDateRange,
  validateIsoDate,
} from "./validation.js";

export function registerAstronomyTools(server: McpServer) {
  server.registerTool(
    "get_astronomy",
    {
      title: "Astronomy Data",
      annotations: {
        readOnlyHint: true,
      },
      description: `Get sunrise, sunset, moonrise, moonset, twilight times, golden hour, blue hour, sun/moon positions, and moon phase data for any location using ipgeolocation.io (GET /v3/astronomy). Works on all plans including free. Costs 1 credit per request.

Look up by coordinates, city/address, or IP address. All lookup modes work on both free and paid plans. Supports custom dates and elevation for precise calculations.

Returns: sunrise, sunset, solar_noon, day_length, moonrise, moonset, civil/nautical/astronomical twilight start and end times, golden_hour and blue_hour start and end, sun_altitude, sun_azimuth, sun_distance, moon_altitude, moon_azimuth, moon_distance, moon_parallactic_angle, moon_phase (name and value 0-1), moon_illumination percentage.

The lang parameter for non-English location field responses is available on paid plans only. Free plan returns English responses regardless.`,
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
            "Response language for location fields in IP-based lookups (en, de, ru, ja, fr, cn, es, cs, it, ko, fa, pt). Paid plans only. Free plan returns English."
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

        const result = await getAstronomy(params);
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
      description: `Get daily astronomical data for a date range (up to 90 days) using ipgeolocation.io's astronomy time series endpoint (GET /v3/astronomy/timeSeries). Works on all plans including free. Costs 1 credit per request regardless of the number of days.

Returns an array of daily astronomy objects, one per day in the range. Each object includes: date, sunrise, sunset, solar_noon, day_length, moonrise, moonset, moon_phase, moon_illumination_percentage, and all twilight/golden hour/blue hour times.

Time series responses do not include real-time positional data (sun_altitude, sun_azimuth, sun_distance, moon_altitude, moon_azimuth, moon_distance, moon_parallactic_angle). For those fields, use get_astronomy with a specific date instead.

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

        const result = await getAstronomyTimeSeries(params);
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
