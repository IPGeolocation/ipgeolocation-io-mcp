import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerGeolocationTools } from "./tools/geolocation.js";
import { registerSecurityTools } from "./tools/security.js";
import { registerTimezoneTools } from "./tools/timezone.js";
import { registerAstronomyTools } from "./tools/astronomy.js";
import { registerAsnTools } from "./tools/asn.js";
import { registerAbuseTools } from "./tools/abuse.js";
import { registerUserAgentTools } from "./tools/useragent.js";

const server = new McpServer({
  name: "ipgeolocation-io-mcp",
  version: "1.0.2",
});

registerGeolocationTools(server);
registerSecurityTools(server);
registerTimezoneTools(server);
registerAstronomyTools(server);
registerAsnTools(server);
registerAbuseTools(server);
registerUserAgentTools(server);

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
