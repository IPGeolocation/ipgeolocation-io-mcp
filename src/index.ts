import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { registerGeolocationTools } from "./tools/geolocation.js";
import { registerSecurityTools } from "./tools/security.js";
import { registerTimezoneTools } from "./tools/timezone.js";
import { registerAstronomyTools } from "./tools/astronomy.js";
import { registerAsnTools } from "./tools/asn.js";
import { registerAbuseTools } from "./tools/abuse.js";
import { registerUserAgentTools } from "./tools/useragent.js";
import { RuntimeConfig, withRuntimeConfig } from "./config.js";

const toolSelectionInstructionParts = [
  "Plan tool usage before making calls.",
  "Identify requested data domains before the first call.",
  "IP domains are: security, abuse, ownership (company/asn), network, location, timezone, and currency.",
  "Use bulk tools when the user provides multiple inputs.",
  "If one IP needs two or more IP domains, make one lookup_ip call first with include and targeted fields/excludes.",
  "If multiple IPs need two or more domains each, make one bulk_lookup_ip call first with include and targeted fields/excludes.",
  "Use narrow IP tools (check_security, get_abuse_contact, lookup_company, lookup_network, lookup_currency) only for single-domain requests.",
  "Leave optional parameters unset unless they change the answer.",
  "Use fields to request only required paths and use excludes to remove irrelevant data.",
  "Leave force_refresh unset unless the user explicitly asks to refresh, rerun, or bypass cache.",
  "If the first response is a superset of what is needed, answer from that response and do not call another tool for formatting.",
  "For ASN queries, make at most one lookup_asn call per target and include set. Do not re-call lookup_asn for the same target only to change fields/excludes or output shape.",
  "Never call the same tool twice for the same target in one answer unless the prior call failed or required data is truly missing.",
  "If multiple tools can satisfy the request, choose the lower-credit and lower-latency path."
];

const TOOL_SELECTION_INSTRUCTIONS = toolSelectionInstructionParts.join(" ");

export const configSchema = z.object({
  apiKey: z.string().describe("Your IPGeolocation.io API key"),
});

type SessionConfig = z.infer<typeof configSchema>;

function withServerRuntimeConfig(server: McpServer, config: Partial<RuntimeConfig>): McpServer {
  const registerTool = ((
    name: unknown,
    metadata: unknown,
    handler: unknown
  ) => {
    const typedHandler = handler as (...args: unknown[]) => unknown;
    return (server.registerTool as unknown as (
      toolName: unknown,
      toolMetadata: unknown,
      toolHandler: (...args: unknown[]) => unknown
    ) => unknown)(
      name,
      metadata,
      (...args: unknown[]) => withRuntimeConfig(config, () => typedHandler(...args))
    );
  }) as McpServer["registerTool"];

  return {
    registerTool,
  } as unknown as McpServer;
}

export function createMcpServer(
  config: Partial<SessionConfig> = {}
): McpServer {
  const server = new McpServer({
    name: "ipgeolocation-io-mcp",
    version: "1.0.16",
  }, {
    instructions: TOOL_SELECTION_INSTRUCTIONS,
  });
  const configuredServer = withServerRuntimeConfig(server, config);

  registerGeolocationTools(configuredServer);
  registerSecurityTools(configuredServer);
  registerTimezoneTools(configuredServer);
  registerAstronomyTools(configuredServer);
  registerAsnTools(configuredServer);
  registerAbuseTools(configuredServer);
  registerUserAgentTools(configuredServer);

  return server;
}

export default function createServer(
  { config = {} }: { config?: Partial<SessionConfig> } = {}
) {
  return createMcpServer(config).server;
}

export async function startStdioServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();

  // Keep the process alive while waiting for stdio JSON-RPC messages.
  process.stdin.resume();
  await server.connect(transport);

  process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await server.close();
    process.exit(0);
  });
}
