import { isIP } from "node:net";
import { getMaxToolArgumentBytes, getRequestTimeoutMs } from "./config.js";

export interface HostedConfig {
  host: string;
  port: number;
  publicUrl: URL;
  allowedOrigins: ReadonlySet<string>;
  trustedProxies: ReadonlySet<string>;
  maxConcurrent: number;
  requestTimeoutMs: number;
  shutdownGraceMs: number;
  maxBodyBytes: number;
}

export function loadHostedConfig(env: NodeJS.ProcessEnv = process.env): HostedConfig {
  const integer = (name: string, fallback: number, min: number, max: number): number => {
    if (env[name] === undefined) return fallback;
    const raw = env[name]!.trim();
    const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error("Invalid " + name + ".");
    return value;
  };
  const host = env.IPGEOLOCATION_MCP_HTTP_HOST ?? "127.0.0.1";
  if (!isIP(host)) throw new Error("IPGEOLOCATION_MCP_HTTP_HOST must be an IP address.");
  let publicUrl: URL;
  try { publicUrl = new URL(env.IPGEOLOCATION_MCP_PUBLIC_URL ?? "https://mcp.ipgeolocation.io/mcp"); }
  catch { throw new Error("Invalid IPGEOLOCATION_MCP_PUBLIC_URL."); }
  const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(publicUrl.hostname);
  if (publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash ||
      publicUrl.pathname !== "/mcp" || (publicUrl.protocol !== "https:" && !(loopback && publicUrl.protocol === "http:"))) {
    throw new Error("IPGEOLOCATION_MCP_PUBLIC_URL must be an HTTPS /mcp URL without credentials, query or fragment (HTTP is allowed only on loopback).");
  }
  const origins = new Set([publicUrl.origin]);
  for (const raw of (env.IPGEOLOCATION_MCP_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean)) {
    let url: URL;
    try { url = new URL(raw); } catch { throw new Error("Invalid IPGEOLOCATION_MCP_ALLOWED_ORIGINS."); }
    if (url.origin !== raw || (url.protocol !== "https:" && !(url.protocol === "http:" &&
      ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)))) {
      throw new Error("Allowed origins must be exact HTTPS origins (or HTTP loopback origins).");
    }
    origins.add(url.origin);
  }
  if (origins.size > 32) throw new Error("Too many allowed origins.");
  const trustedProxies = new Set(["127.0.0.1", "::1"]);
  for (const address of (env.IPGEOLOCATION_MCP_TRUSTED_PROXIES ?? "").split(",").map(value => value.trim()).filter(Boolean)) {
    if (!isIP(address) || address.includes("%")) throw new Error("IPGEOLOCATION_MCP_TRUSTED_PROXIES must contain exact IP addresses.");
    trustedProxies.add(address);
  }
  if (trustedProxies.size > 32) throw new Error("Too many trusted proxies.");
  const maxConcurrent = integer("IPGEOLOCATION_MCP_HTTP_CONCURRENCY", 32, 1, 256);
  return {
    host,
    port: integer("IPGEOLOCATION_MCP_HTTP_PORT", 8787, 0, 65535),
    publicUrl,
    allowedOrigins: origins,
    trustedProxies,
    maxConcurrent,
    requestTimeoutMs: getRequestTimeoutMs() + 5000,
    shutdownGraceMs: 5000,
    maxBodyBytes: Math.min(32 * 1024 * 1024, 6 * getMaxToolArgumentBytes() + 128 * 1024),
  };
}
