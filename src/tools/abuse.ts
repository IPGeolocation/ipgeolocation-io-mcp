import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAbuseContact } from "../client.js";

export function registerAbuseTools(server: McpServer) {
  server.registerTool(
    "get_abuse_contact",
    {
      description: `Get abuse contact information for any IP address using ipgeolocation.io's dedicated abuse endpoint (GET /v3/abuse). Paid plans only. Free plan returns 401 Unauthorized. Costs 1 credit per lookup.

Returns: route, country, name, organization, kind, address, emails (array), phone_numbers (array). Useful for reporting malicious activity to the correct network operator.

Note: abuse data is also available through lookup_ip with include=abuse, which costs 2 credits total (1 base + 1 for abuse) but also returns full geolocation data. If you only need the abuse contact without geolocation, this dedicated endpoint is cheaper at 1 credit. Tip: you can also use lookup_ip with include=abuse&fields=abuse to get just the abuse data for 1 credit total. The fields and excludes parameters work on all plans to filter the response.`,
      inputSchema: {
        ip: z
          .string()
          .optional()
          .describe(
            "IPv4 or IPv6 address to get abuse contact for. Omit to use the caller's IP."
          ),
        fields: z
          .string()
          .optional()
          .describe(
            "Comma-separated fields to return (e.g. emails,organization). Reduces response size. Works on all plans."
          ),
        excludes: z
          .string()
          .optional()
          .describe(
            "Comma-separated fields to exclude from response (e.g. phone_numbers,address)."
          ),
      },
    },
    async (params) => {
      try {
        const result = await getAbuseContact(params);
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
