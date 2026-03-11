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
      description: `Parse an explicit user-agent string via POST /v3/user-agent. Paid only. Cost: 1 credit. Returns browser, device, OS, and engine details.

This MCP tool parses only the uaString you pass. It does not infer a caller user-agent from the MCP transport. For multiple strings, use bulk_parse_user_agent.`,
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
      description: `Bulk user-agent parsing via POST /v3/user-agent-bulk for up to ${MAX_BULK_ITEMS.toLocaleString()} strings per MCP request. Paid only. Cost: 1 credit per string.

Use this tool for multiple user-agent strings. For a single string, use parse_user_agent.`,
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
