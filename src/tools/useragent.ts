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
      description: `Parse an explicit user-agent string via POST /v3/user-agent. Paid only for this POST-based tool. Cost: 1 credit per successful user-agent. Returns JSON with parsed user_agent_string, name, version, version_major, device, engine, and operating_system fields; device and OS types can classify Robot, Hacker, Anonymized, or Unknown values.

uaString must be the exact non-empty user-agent string to parse. This MCP tool does not infer a caller user-agent from the MCP transport. force_refresh bypasses this server's cache only when the user asks. Use bulk_parse_user_agent for multiple strings.`,
      inputSchema: {
        uaString: z
          .string()
          .describe(
            "The user-agent string to parse (e.g. Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36)."
          ),
        force_refresh: z
          .boolean()
          .optional()
          .describe("Default false. Leave unset unless the user asks to refresh or rerun."),
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
      description: `Bulk user-agent parsing via POST /v3/user-agent-bulk for up to ${MAX_BULK_ITEMS.toLocaleString()} strings per MCP request. Paid only. Cost: 1 credit per successful user-agent string.

Returns one parsed result per string with the same user_agent_string, name, version, version_major, device, engine, and operating_system fields as parse_user_agent. uaStrings must be a non-empty array of explicit user-agent strings. force_refresh bypasses this server's cache only when the user asks. Use parse_user_agent for one string.`,
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
          .describe("Default false. Leave unset unless the user asks to refresh or rerun."),
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
