#!/usr/bin/env node
import { createHostedServer } from "./http.js";
import { loadHostedConfig } from "./http-config.js";

try {
  const config = loadHostedConfig();
  const hosted = createHostedServer(config);
  hosted.server.once("error", () => {
    console.error(JSON.stringify({ event: "http_startup_failed" }));
    process.exitCode = 1;
    void hosted.close();
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => { void hosted.close(); });
  }
  hosted.server.listen(config.port, config.host, () => {
    console.error(JSON.stringify({ event: "http_listening", url: config.publicUrl.href,
      port: (hosted.server.address() as { port: number }).port }));
  });
} catch (error) {
  console.error(JSON.stringify({ event: "http_configuration_failed", message: error instanceof Error ? error.message : "Invalid configuration." }));
  process.exitCode = 1;
}
