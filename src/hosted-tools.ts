import { z } from "zod";

const explicitIpTools = new Set([
  "lookup_ip", "lookup_company", "lookup_currency", "lookup_network",
  "check_security", "get_abuse_contact",
]);
const selectors: Record<string, readonly string[]> = {
  get_timezone: ["tz", "lat", "long", "location", "ip", "iata_code", "icao_code", "lo_code"],
  get_astronomy: ["lat", "long", "location", "ip"],
  get_astronomy_time_series: ["lat", "long", "location", "ip"],
  lookup_asn: ["asn", "ip"],
};

export function hostedInputSchema(name: string, shape: z.ZodRawShape) {
  const fields = { ...shape };
  if (explicitIpTools.has(name)) {
    const original = fields.ip as z.ZodOptional<z.ZodType>;
    fields.ip = original.unwrap()
      .describe(hostedDescription(original.description ?? "Explicit target IP address.") + " Required on hosted MCP.");
  }
  const schema = z.strictObject(fields);
  const choices = selectors[name];
  if (!choices) return schema;
  const alternatives = choices.filter(field => field !== "lat" && field !== "long").map(field => ({ required: [field] }));
  if (choices.includes("lat")) alternatives.push({ required: ["lat", "long"] });
  return schema.refine(args => choices.some(field =>
    typeof args[field] === "string" && args[field].trim().length > 0
  ), "Hosted MCP requires an explicit target: " + choices.join(", ") + ".").meta({ anyOf: alternatives });
}

export function hostedDescription(description: string): string {
  return description
    .replaceAll("ip omitted means the server's public egress IP.", "An explicit ip target is required on hosted MCP.")
    .replaceAll("Omit to use the server's public egress IP.", "An explicit target is required on hosted MCP.")
    .replaceAll("Omit to check the server's public egress IP.", "An explicit target is required on hosted MCP.")
    .replaceAll("omit it for the server machine's public egress IP", "an explicit IP target is required on hosted MCP")
    .replaceAll(", then the server's public egress IP when no selector is provided", "; an explicit selector is required on hosted MCP")
    .replaceAll("IP/server-address lookups", "IP lookups");
}
