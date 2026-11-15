import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CancelledNotificationSchema, JSONRPCMessageSchema, LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS, isInitializeRequest, isJSONRPCRequest } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer } from "./index.js";
import { loadHostedConfig, type HostedConfig } from "./http-config.js";

const KEY_HEADER = "x-ipgeolocation-api-key";
const SESSION_HEADER = "mcp-session-id";

class HttpFailure extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

function canonicalIp(address: string): string | undefined {
  const version = isIP(address);
  if (!version || address.includes("%")) return undefined;
  // Node may report an IPv4 socket as an IPv4-mapped IPv6 address.
  return new URL(`http://[${version === 4 ? "::ffff:" + address : address}]`).hostname;
}

function singleHeader(req: IncomingMessage, name: string): string | undefined {
  let count = 0;
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    if (req.rawHeaders[i].toLowerCase() === name) count++;
  }
  const value = req.headers[name];
  if (count > 1 || Array.isArray(value)) throw new HttpFailure(400, "duplicate_header");
  return value;
}

function removePrivateHeaders(req: IncomingMessage): void {
  const hidden = (name: string) => name === KEY_HEADER || name === "authorization" ||
    name === "cookie" || name === SESSION_HEADER || name === "forwarded" || name === "x-real-ip" || name === "cf-connecting-ip" ||
    name.startsWith("x-forwarded-") || name.startsWith("x-ipgeo");
  for (const name of Object.keys(req.headers)) if (hidden(name)) delete req.headers[name];
  // The SDK's Node adapter reads rawHeaders, independently of req.headers.
  req.rawHeaders = req.rawHeaders.reduce<string[]>((headers, name, index, all) => {
    if (index % 2 === 0 && !hidden(name.toLowerCase())) headers.push(name, all[index + 1]);
    return headers;
  }, []);
}

function reply(res: ServerResponse, status: number, code: string): void {
  if (res.destroyed || res.writableEnded) return;
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: code }));
}

function closeUnreadBody(req: IncomingMessage, res: ServerResponse): void {
  if (!req.complete) {
    res.shouldKeepAlive = false;
    if (!res.headersSent) res.setHeader("Connection", "close");
    res.once("finish", () => { if (!req.complete) req.destroy(); });
  }
}

function checkMessageBudget(body: unknown): void {
  const stack = [{ value: body, depth: 0 }];
  let entries = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (depth > 64) throw new HttpFailure(400, "message_nesting_limit");
    if (typeof value !== "object" || value === null) continue;
    for (const child of Object.values(value)) {
      if (++entries > 100000) throw new HttpFailure(413, "message_capacity");
      if (typeof child === "object" && child !== null) stack.push({ value: child, depth: depth + 1 });
    }
  }
}

function checkJsonStructure(text: string): void {
  let quoted = false;
  let escaped = false;
  let depth = 0;
  let structures = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{" || char === "[") {
      if (++depth > 64) throw new HttpFailure(400, "message_nesting_limit");
      if (++structures > 100000) throw new HttpFailure(413, "message_capacity");
    } else if (char === "}" || char === "]") depth--;
    else if ((char === ":" || char === ",") && ++structures > 100000) throw new HttpFailure(413, "message_capacity");
  }
}

interface ActiveCall {
  transport: StreamableHTTPServerTransport;
  response: ServerResponse;
  id: string | number;
}

export interface HostedServer {
  server: http.Server;
  close(): Promise<void>;
}

export function createHostedServer(
  config: HostedConfig = loadHostedConfig(),
  log: (entry: Record<string, unknown>) => void = entry => console.error(JSON.stringify(entry)),
): HostedServer {
  const sessionSecret = randomBytes(32);
  const trustedProxies = new Set([...config.trustedProxies].map(canonicalIp));
  const calls = new Map<string, ActiveCall>();
  const responses = new Set<ServerResponse>();
  const receiving = new Set<ServerResponse>();
  const executing = new Set<ServerResponse>();
  const sockets = new Set<Socket>();
  const smallBody = 64 * 1024;
  const maxConnections = Math.max(256, 2 * config.maxConcurrent + 64);
  const smallBudget = (maxConnections + config.maxConcurrent) * smallBody;
  let smallBytes = 0;
  let largeBytes = 0;
  let draining = false;
  let closing: Promise<void> | undefined;

  const signature = (scope: string, apiKey: string) => createHmac("sha256", sessionSecret)
    .update(scope).update("\0").update(apiKey).digest("base64url");
  const mintSession = (version: string, apiKey: string) => {
    const scope = `s1.${version}.${randomBytes(24).toString("base64url")}`;
    return scope + "." + signature(scope, apiKey);
  };
  const sessionVersion = (id: string, apiKey: string) => {
    if (!/^s1\.\d{4}-\d{2}-\d{2}\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{43}$/.test(id)) {
      throw new HttpFailure(404, "session_not_found");
    }
    const scope = id.slice(0, -44);
    if (!timingSafeEqual(Buffer.from(id.slice(-43)), Buffer.from(signature(scope, apiKey)))) {
      throw new HttpFailure(404, "session_not_found");
    }
    return id.split(".")[1];
  };
  const cancel = (call: ActiveCall) => {
    call.transport.onmessage?.({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: call.id } });
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const started = performance.now();
    const requestId = randomUUID();
    const peerIp = req.socket.remoteAddress ?? "";
    const canonicalPeer = canonicalIp(peerIp);
    const forwardedIp = req.headersDistinct["x-real-ip"];
    const clientIp = canonicalPeer && trustedProxies.has(canonicalPeer) && forwardedIp?.length === 1 && canonicalIp(forwardedIp[0])
      ? forwardedIp[0] : peerIp.replace(/^::ffff:(?=\d+\.)/i, "");
    let reservedBytes = 0;
    let large = false;
    let deadline: NodeJS.Timeout | undefined;
    let bodyDeadline: NodeJS.Timeout | undefined;
    let mcp: ReturnType<typeof createMcpServer> | undefined;
    let activeCall: ActiveCall | undefined;
    let correlation: string | undefined;
    const responseClosed = new Promise<void>(resolve => {
      res.once("close", () => {
        if (!res.writableFinished && activeCall) cancel(activeCall);
        resolve();
      });
    });
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Request-ID", requestId);
    res.setHeader("Vary", "Origin");
    res.once("close", () => log({
      event: "http_request", timestamp: new Date().toISOString(), request_id: requestId,
      client_ip: clientIp || null, peer_ip: peerIp || null,
      method: ["POST", "GET", "HEAD", "DELETE", "OPTIONS"].includes(req.method ?? "") ? req.method : "OTHER",
      route: req.url === "/mcp" ? "/mcp" : req.url === "/health" ? "/health" : "unmatched",
      status: res.writableFinished ? res.statusCode : 499, duration_ms: Math.round(performance.now() - started),
    }));
    try {
      const host = singleHeader(req, "host");
      const localHealth = req.url === "/health" && host !== undefined &&
        /^(127\.0\.0\.1|\[::1\]|localhost)(:\d+)?$/.test(host);
      if (!host || (host.toLowerCase() !== config.publicUrl.host.toLowerCase() && !localHealth)) {
        throw new HttpFailure(421, "unrecognized_host");
      }
      const origin = singleHeader(req, "origin");
      if (origin !== undefined) {
        if (!config.allowedOrigins.has(origin)) throw new HttpFailure(403, "origin_not_allowed");
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, X-Request-ID, Retry-After, WWW-Authenticate");
      }
      if (req.url !== "/mcp" && req.url !== "/health") {
        throw new HttpFailure(req.url?.startsWith("/mcp?") ? 400 : 404, "unsupported_request_target");
      }
      if (draining) throw new HttpFailure(503, "server_shutting_down");
      if (req.url === "/health") {
        if (req.method !== "GET" && req.method !== "HEAD") {
          res.setHeader("Allow", "GET, HEAD");
          throw new HttpFailure(405, "method_not_allowed");
        }
        if (req.method === "HEAD") res.writeHead(200).end();
        else res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ status: "ok" }));
        return;
      }
      if (req.method === "OPTIONS") {
        const requested = singleHeader(req, "access-control-request-headers");
        const allowed = new Set(["content-type", KEY_HEADER, SESSION_HEADER, "mcp-protocol-version", "accept"]);
        const method = singleHeader(req, "access-control-request-method");
        if (!origin || !["GET", "POST", "DELETE"].includes(method ?? "") || (requested && requested.split(",").some(name => !allowed.has(name.trim().toLowerCase())))) {
          throw new HttpFailure(403, "preflight_not_allowed");
        }
        res.writeHead(204, {
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-IPGeolocation-API-Key, Mcp-Session-Id, Mcp-Protocol-Version, Accept",
          "Access-Control-Max-Age": "300",
        }).end();
        return;
      }
      if (req.method !== "POST" && req.method !== "DELETE") {
        res.setHeader("Allow", "POST, OPTIONS");
        throw new HttpFailure(405, "method_not_allowed");
      }
      const apiKey = singleHeader(req, KEY_HEADER);
      if (!apiKey || !/^[\x21-\x7e]{1,256}$/.test(apiKey) || apiKey.includes("\\")) {
        res.setHeader("WWW-Authenticate", 'ApiKey realm="IPGeolocation.io MCP", header="X-IPGeolocation-API-Key"');
        throw new HttpFailure(401, "api_key_required");
      }
      const sessionId = singleHeader(req, SESSION_HEADER);
      const version = sessionId === undefined ? undefined : sessionVersion(sessionId, apiKey);
      const protocol = singleHeader(req, "mcp-protocol-version");
      if (version && protocol !== undefined && protocol !== version) throw new HttpFailure(400, "protocol_version_mismatch");
      if (req.method === "DELETE") {
        // Stateless tokens have no idle record to delete; MCP permits HTTP 405.
        res.setHeader("Allow", "POST, OPTIONS");
        throw new HttpFailure(405, "session_termination_not_supported");
      }
      if (receiving.size >= maxConnections) throw new HttpFailure(503, "upload_capacity");
      receiving.add(res);
      responses.add(res);
      const bodyLimit = sessionId ? config.maxBodyBytes : Math.min(smallBody, config.maxBodyBytes);
      const type = singleHeader(req, "content-type") ?? "";
      if (!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(type) ||
          (req.headers["content-encoding"] && req.headers["content-encoding"] !== "identity")) {
        throw new HttpFailure(415, "json_body_required");
      }
      const accept = singleHeader(req, "accept") ?? "";
      if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
        throw new HttpFailure(406, "unsupported_accept");
      }
      const length = req.headers["content-length"];
      if (length && Number(length) > bodyLimit) throw new HttpFailure(413, "body_too_large");
      const chunks: Buffer[] = [];
      bodyDeadline = setTimeout(() => {
        closeUnreadBody(req, res);
        reply(res, 408, "body_deadline");
      }, Math.min(config.requestTimeoutMs, 5000));
      bodyDeadline.unref();
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const size = reservedBytes + buffer.length;
        if (size > bodyLimit) throw new HttpFailure(413, "body_too_large");
        if (!large && size > smallBody) {
          if (largeBytes + size > 2 * config.maxBodyBytes) throw new HttpFailure(503, "body_capacity");
          smallBytes -= reservedBytes;
          largeBytes += size;
          large = true;
        } else if (large) {
          if (largeBytes + buffer.length > 2 * config.maxBodyBytes) throw new HttpFailure(503, "body_capacity");
          largeBytes += buffer.length;
        } else {
          if (smallBytes + buffer.length > smallBudget) throw new HttpFailure(503, "body_capacity");
          smallBytes += buffer.length;
        }
        reservedBytes = size;
        chunks.push(buffer);
      }
      clearTimeout(bodyDeadline);
      receiving.delete(res);
      if (res.writableEnded || res.destroyed) return;
      let body: unknown;
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
        checkJsonStructure(text);
        body = JSON.parse(text);
      } catch (error) {
        if (error instanceof HttpFailure) throw error;
        throw new HttpFailure(400, "invalid_json");
      }
      chunks.length = 0;
      if (Array.isArray(body)) throw new HttpFailure(400, "batch_messages_not_supported");
      if (reservedBytes > smallBody && !(body && typeof body === "object" && "method" in body && body.method === "tools/call")) {
        throw new HttpFailure(413, "control_message_too_large");
      }
      checkMessageBudget(body);
      if (body && typeof body === "object" && "method" in body && body.method === "tools/call") {
        const { params, ...envelope } = body as Record<string, unknown>;
        const { arguments: _arguments, ...metadata } = params && typeof params === "object" && !Array.isArray(params)
          ? params as Record<string, unknown> : { value: params };
        if (Buffer.byteLength(JSON.stringify({ ...envelope, params: metadata }), "utf8") > smallBody) {
          throw new HttpFailure(413, "control_message_too_large");
        }
      }
      const parsed = JSONRPCMessageSchema.safeParse(body);
      if (!parsed.success) throw new HttpFailure(400, "invalid_jsonrpc");
      const initializing = isInitializeRequest(body);
      if (!sessionId && !initializing) throw new HttpFailure(400, "initialize_required");
      if (sessionId && initializing) throw new HttpFailure(400, "already_initialized");
      if (version && protocol === undefined) {
        req.headers["mcp-protocol-version"] = version;
        req.rawHeaders.push("Mcp-Protocol-Version", version);
      }
      const cancelled = CancelledNotificationSchema.safeParse(body);
      if (cancelled.success && !isJSONRPCRequest(body)) {
        const target = calls.get(JSON.stringify([sessionId, cancelled.data.params.requestId]));
        if (target) {
          cancel(target);
          if (!target.response.headersSent) target.response.writeHead(204).end();
          else target.response.destroy();
        }
        res.writeHead(202).end();
        return;
      }
      if (executing.size >= config.maxConcurrent) {
        res.setHeader("Retry-After", "1");
        throw new HttpFailure(503, "server_busy");
      }
      executing.add(res);
      deadline = setTimeout(() => {
        if (activeCall) cancel(activeCall);
        reply(res, 504, "request_deadline");
      }, config.requestTimeoutMs);
      deadline.unref();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      mcp = createMcpServer({ apiKey }, { hosted: true });
      if (isJSONRPCRequest(body) && sessionId) {
        correlation = JSON.stringify([sessionId, body.id]);
        if (calls.has(correlation)) throw new HttpFailure(409, "duplicate_request_id");
        activeCall = { transport, response: res, id: body.id };
        calls.set(correlation, activeCall);
      }
      await mcp.connect(transport);
      if (res.writableEnded || res.destroyed) return;
      if (isInitializeRequest(body)) {
        const requested = body.params.protocolVersion;
        res.setHeader("Mcp-Session-Id", mintSession(SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION, apiKey));
      }
      removePrivateHeaders(req);
      await Promise.race([transport.handleRequest(req, res, body), responseClosed]);
    } catch (error) {
      closeUnreadBody(req, res);
      if (error instanceof HttpFailure) reply(res, error.status, error.code);
      else if (req.aborted) reply(res, 400, "request_aborted");
      else {
        log({ event: "http_handler_failed", request_id: requestId });
        reply(res, 500, "internal_error");
      }
    } finally {
      if (deadline) clearTimeout(deadline);
      if (bodyDeadline) clearTimeout(bodyDeadline);
      if (mcp) await mcp.close().catch(() => { log({ event: "request_close_failed" }); });
      if (correlation && calls.get(correlation) === activeCall) calls.delete(correlation);
      if (large) largeBytes -= reservedBytes;
      else smallBytes -= reservedBytes;
      receiving.delete(res);
      executing.delete(res);
      responses.delete(res);
    }
  }

  const server = http.createServer({
    maxHeaderSize: 16 * 1024, headersTimeout: 10000, requestTimeout: 15000,
    keepAliveTimeout: 5000, connectionsCheckingInterval: 1000,
  }, (req, res) => { void handle(req, res); });
  server.maxConnections = maxConnections;
  server.maxRequestsPerSocket = 1000;
  server.on("connection", socket => {
    sockets.add(socket);
    socket.on("error", () => socket.destroy());
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("checkContinue", (req, res) => { closeUnreadBody(req, res); reply(res, 417, "expectation_not_supported"); });
  server.on("checkExpectation", (req, res) => { closeUnreadBody(req, res); reply(res, 417, "expectation_not_supported"); });
  const rejectSocket = (socket: Duplex) => {
    if (socket.destroyed) return;
    const deadline = setTimeout(() => socket.destroy(), 1000);
    deadline.unref();
    socket.once("close", () => clearTimeout(deadline));
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n", () => socket.destroy());
  };
  server.on("upgrade", (_req, socket) => { rejectSocket(socket); });
  server.on("clientError", (_error, socket) => {
    if (!socket.destroyed && socket.writable) rejectSocket(socket);
    else socket.destroy();
  });
  return {
    server,
    close() {
      if (closing) return closing;
      draining = true;
      closing = (async () => {
        const deadline = setTimeout(() => {
          for (const call of calls.values()) cancel(call);
          for (const res of responses) res.destroy();
          server.closeAllConnections();
          for (const socket of sockets) socket.destroy();
        }, config.shutdownGraceMs);
        deadline.unref();
        try { await new Promise<void>(resolve => server.close(() => resolve())); }
        finally { clearTimeout(deadline); }
      })();
      return closing;
    },
  };
}
