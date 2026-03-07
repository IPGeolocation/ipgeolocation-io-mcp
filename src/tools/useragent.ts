import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { parseUserAgent, parseUserAgentBulk } from "../client.js";
import {
  MAX_BULK_ITEMS,
  errorToolResponse,
  formatToolResult,
} from "./response.js";
import { getCachedValue, setCachedValue } from "./cache.js";

function buildUserAgentCacheKey(uaString: string): string {
  return `user-agent|payload=${JSON.stringify({ uaString })}`;
}

function buildUserAgentBulkCacheKey(uaStrings: string[]): string {
  return `user-agent-bulk|payload=${JSON.stringify({ uaStrings })}`;
}

export function registerUserAgentTools(server: McpServer) {
  server.registerTool(
    "parse_user_agent",
    {
      title: "User-Agent Parser",
      annotations: {
        readOnlyHint: true,
      },
      description: `Parse a user-agent string into structured device, browser, OS, and engine details using ipgeolocation.io's dedicated User-Agent endpoint (POST /v3/user-agent). Paid plans only. Free plan returns 401 Unauthorized. Costs 1 credit per request.

Returns: user_agent_string, name (browser/bot name), type (Browser, Crawler, etc.), version, version_major, device (name, type, brand, cpu), engine (name, type, version, version_major), operating_system (name, type, version, version_major, build).

This MCP tool parses only the explicit user-agent string you pass in uaString. It does not infer a caller user-agent from the MCP transport. For parsing multiple UA strings at once, use bulk_parse_user_agent instead.`,
      inputSchema: {
        uaString: z
          .string()
          .describe(
            "The user-agent string to parse (e.g. Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36)."
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
        const cacheKey = buildUserAgentCacheKey(params.uaString);
        const cached = params.force_refresh ? undefined : getCachedValue(cacheKey);
        const result =
          cached ??
          (await parseUserAgent({
            uaString: params.uaString,
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
    "bulk_parse_user_agent",
    {
      title: "Bulk User-Agent Parser",
      annotations: {
        readOnlyHint: true,
      },
      description: `Parse up to ${MAX_BULK_ITEMS.toLocaleString()} user-agent strings in a single request using ipgeolocation.io's bulk User-Agent endpoint (POST /v3/user-agent-bulk). This MCP server caps request size to keep responses manageable over MCP (the raw API supports up to 50,000). Paid plans only. Free plan returns 401 Unauthorized. Costs 1 credit per user-agent string.

Returns a JSON array of parsed user-agent objects. Each object contains the same fields as parse_user_agent: user_agent_string, name, type, version, version_major, device (name, type, brand, cpu), engine (name, type, version, version_major), operating_system (name, type, version, version_major, build).

Use this tool when you need to parse multiple user-agent strings at once. For a single UA string, use parse_user_agent instead.`,
      inputSchema: {
        uaStrings: z
          .array(z.string())
          .min(1)
          .max(MAX_BULK_ITEMS)
          .describe(
            `Array of user-agent strings to parse. Minimum 1, maximum ${MAX_BULK_ITEMS.toLocaleString()} in this MCP server.`
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
        const cacheKey = buildUserAgentBulkCacheKey(params.uaStrings);
        const cached = params.force_refresh ? undefined : getCachedValue(cacheKey);
        const result =
          cached ??
          (await parseUserAgentBulk({
            uaStrings: params.uaStrings,
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
