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
      description: `Read-only custom user-agent parsing via POST /v3/user-agent. Paid only for POST payload parsing. Cost: 1 credit per successful string. This tool parses only the explicit uaString value; it cannot read caller headers or transport metadata.

Returns { user_agent_string, name, version, version_major, device, engine, operating_system }; device.type and operating_system.type can include Desktop, Mobile, Robot, Hacker, Anonymized, or Unknown. uaString must be the exact non-empty user-agent string to parse. force_refresh bypasses cache and makes a fresh upstream request only when the user asks. Use bulk_parse_user_agent for multiple strings.`,
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
            "Default false. Set true only when the user asks to refresh cached user-agent parsing data; a successful refresh makes a new upstream request and can consume credits."
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
      description: `Read-only bulk user-agent parsing via POST /v3/user-agent-bulk. Paid only. Cost: 1 credit per successful string. This MCP server accepts up to ${MAX_BULK_ITEMS.toLocaleString()} explicit user-agent strings.

Returns one parsed object per string with user_agent_string, name, version, version_major, device, engine, and operating_system fields. uaStrings must be a non-empty array of exact user-agent strings; use parse_user_agent for one string. force_refresh bypasses cache and makes a fresh upstream request only when the user asks.`,
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
            "Default false. Set true only when the user asks to refresh cached bulk user-agent parsing data; a successful refresh makes a new upstream request and can consume credits."
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
