import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { parseUserAgent, parseUserAgentBulk } from "../client.js";

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

This is the same user-agent data you can get from lookup_ip with include=user_agent, but that always parses the caller's User-Agent header and costs 1 credit for base geolocation plus 0 for the UA module. This dedicated endpoint lets you parse any arbitrary user-agent string you supply without doing an IP lookup. For parsing multiple UA strings at once, use bulk_parse_user_agent instead.`,
      inputSchema: {
        uaString: z
          .string()
          .describe(
            "The user-agent string to parse (e.g. Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36)."
          ),
      },
    },
    async (params) => {
      try {
        const result = await parseUserAgent(params);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
          isError: true,
        };
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
      description: `Parse up to 50,000 user-agent strings in a single request using ipgeolocation.io's bulk User-Agent endpoint (POST /v3/user-agent-bulk). Paid plans only. Free plan returns 401 Unauthorized. Costs 1 credit per user-agent string.

Returns a JSON array of parsed user-agent objects. Each object contains the same fields as parse_user_agent: user_agent_string, name, type, version, version_major, device (name, type, brand, cpu), engine (name, type, version, version_major), operating_system (name, type, version, version_major, build).

Use this tool when you need to parse multiple user-agent strings at once. For a single UA string, use parse_user_agent instead.`,
      inputSchema: {
        uaStrings: z
          .array(z.string())
          .min(1)
          .max(50000)
          .describe(
            "Array of user-agent strings to parse. Minimum 1, maximum 50,000."
          ),
      },
    },
    async (params) => {
      try {
        const result = await parseUserAgentBulk(params);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
