import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTimezone, convertTimezone } from "../client.js";
import { errorToolResponse, formatToolResult } from "./response.js";
import {
  hasAnyValue,
  validateCoordinatePair,
  validateCoordinatePairNamed,
} from "./validation.js";

export function registerTimezoneTools(server: McpServer) {
  server.registerTool(
    "get_timezone",
    {
      title: "Timezone Lookup",
      annotations: {
        readOnlyHint: true,
      },
      description: `Get current time and timezone details for any location using ipgeolocation.io (GET /v3/timezone). Works on all plans including free. Costs 1 credit per request.

Look up by IANA timezone name, coordinates, city/address, IP address, IATA airport code, ICAO airport code, or UN/LOCODE. All lookup modes work on both free and paid plans. If no parameters are provided, returns timezone data for the caller's IP.

Returns: timezone name, UTC offset, offset with DST, current_time, current_time_unix, timezone abbreviations (standard and DST), is_dst flag, dst_savings, dst_exists, dst_start, dst_end. Airport code lookups also return airport name, city, elevation, and coordinates.

The lang parameter for non-English responses is available on paid plans only. Free plan returns English responses regardless of the lang value.`,
      inputSchema: {
        tz: z
          .string()
          .optional()
          .describe(
            "IANA timezone name (e.g. America/New_York, Europe/London). Highest priority if multiple params provided."
          ),
        lat: z
          .string()
          .optional()
          .describe("Latitude coordinate. Must be used together with long."),
        long: z
          .string()
          .optional()
          .describe("Longitude coordinate. Must be used together with lat."),
        location: z
          .string()
          .optional()
          .describe("City or address string (e.g. London, UK)."),
        ip: z
          .string()
          .optional()
          .describe("IPv4 or IPv6 address to get timezone for."),
        iata_code: z
          .string()
          .optional()
          .describe(
            "3-letter IATA airport code (e.g. JFK, LHR). Returns airport details in the response."
          ),
        icao_code: z
          .string()
          .optional()
          .describe(
            "4-letter ICAO airport code (e.g. KJFK, EGLL). Returns airport details in the response."
          ),
        lo_code: z
          .string()
          .optional()
          .describe("5-character UN/LOCODE (e.g. DEBER, USNYC)."),
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
          "get_timezone"
        );
        if (coordinateError) {
          throw new Error(coordinateError);
        }

        const result = await getTimezone(params);
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
    "convert_timezone",
    {
      title: "Timezone Conversion",
      annotations: {
        readOnlyHint: true,
      },
      description: `Convert time between two locations using ipgeolocation.io (GET /v3/timezone/convert). Works on all plans including free. Costs 1 credit per request.

Specify source and destination by IANA timezone name, coordinates, city/address, IATA airport code, ICAO airport code, or UN/LOCODE. All location modes work on both free and paid plans.

Returns: original time, converted time, diff_hour, and diff_min between the two locations. If no time is specified, converts the current time.`,
      inputSchema: {
        time: z
          .string()
          .optional()
          .describe(
            "Time to convert in yyyy-MM-dd HH:mm or yyyy-MM-dd HH:mm:ss format. Defaults to current time."
          ),
        tz_from: z
          .string()
          .optional()
          .describe("Source IANA timezone name (e.g. America/New_York)."),
        tz_to: z
          .string()
          .optional()
          .describe("Destination IANA timezone name (e.g. Asia/Tokyo)."),
        lat_from: z
          .string()
          .optional()
          .describe("Source latitude. Use with long_from."),
        long_from: z
          .string()
          .optional()
          .describe("Source longitude. Use with lat_from."),
        lat_to: z
          .string()
          .optional()
          .describe("Destination latitude. Use with long_to."),
        long_to: z
          .string()
          .optional()
          .describe("Destination longitude. Use with lat_to."),
        location_from: z
          .string()
          .optional()
          .describe("Source city or address string."),
        location_to: z
          .string()
          .optional()
          .describe("Destination city or address string."),
        iata_from: z
          .string()
          .optional()
          .describe("Source 3-letter IATA airport code."),
        iata_to: z
          .string()
          .optional()
          .describe("Destination 3-letter IATA airport code."),
        icao_from: z
          .string()
          .optional()
          .describe("Source 4-letter ICAO airport code."),
        icao_to: z
          .string()
          .optional()
          .describe("Destination 4-letter ICAO airport code."),
        locode_from: z
          .string()
          .optional()
          .describe("Source 5-character UN/LOCODE."),
        locode_to: z
          .string()
          .optional()
          .describe("Destination 5-character UN/LOCODE."),
      },
    },
    async (params) => {
      try {
        const sourceCoordinateError = validateCoordinatePairNamed(
          params.lat_from,
          params.long_from,
          "lat_from",
          "long_from",
          "convert_timezone"
        );
        if (sourceCoordinateError) {
          throw new Error(sourceCoordinateError);
        }

        const destinationCoordinateError = validateCoordinatePairNamed(
          params.lat_to,
          params.long_to,
          "lat_to",
          "long_to",
          "convert_timezone"
        );
        if (destinationCoordinateError) {
          throw new Error(destinationCoordinateError);
        }

        const hasSource = hasAnyValue([
          params.tz_from,
          params.lat_from,
          params.long_from,
          params.location_from,
          params.iata_from,
          params.icao_from,
          params.locode_from,
        ]);
        if (!hasSource) {
          throw new Error(
            "convert_timezone: provide at least one source selector (tz_from, lat_from/long_from, location_from, iata_from, icao_from, or locode_from)."
          );
        }

        const hasDestination = hasAnyValue([
          params.tz_to,
          params.lat_to,
          params.long_to,
          params.location_to,
          params.iata_to,
          params.icao_to,
          params.locode_to,
        ]);
        if (!hasDestination) {
          throw new Error(
            "convert_timezone: provide at least one destination selector (tz_to, lat_to/long_to, location_to, iata_to, icao_to, or locode_to)."
          );
        }

        const result = await convertTimezone(params);
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
