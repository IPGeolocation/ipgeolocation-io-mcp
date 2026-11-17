# Hosted MCP

The hosted entry point runs the same tool handlers as local MCP over Streamable
HTTP. The existing command and default package entry point continue to use stdio.
General hosted MCP has no dependency on ChatGPT, OpenAI identity, or billing.

Connect to the public IPGeolocation.io server at https://mcp.ipgeolocation.io/mcp.
This guide covers client connections and running your own hosted server.

## Tools and account usage

Hosted MCP exposes sixteen tools. The deliberate differences from local MCP are:

- get_my_ip is unavailable, including direct invocation. A hosted process would
  return the infrastructure's IP rather than the person's IP.
- IP-only lookups require ip. Timezone, astronomy and ASN lookups require an
  explicit supported selector, so omission cannot silently select the server.
- Authentication uses private HTTP headers instead of process environment keys.

All other tool names, output/error schemas, projections, bulk behavior, credit
rules, upstream response limits and cached-page formats use the local code.
The API determines key validity, plan access and charges; tool discovery does not
make a billable key-validation request. Invalid provider keys fail on tool calls.
Security flags remain evidence, not a guarantee of safety.

Hosted MCP adds no per-second, per-minute, per-key or per-IP usage quota. The
[Nginx example](deploy/hosted.nginx.conf) also adds no customer rate or connection
limit. The API's existing account credit/subscription rules still apply, including
upstream 429 quota errors. See the [official FAQ](https://ipgeolocation.io/faq.html).

Fresh upstream requests validate the key and its plan; cached responses and saved
pages make no API request. Revoking a key or changing its plan does not immediately
remove cached access. The default cache lifetime is five minutes; reading pages
extends their idle expiry. This is not a fixed maximum revocation delay. Immediate
revocation would need an authoritative zero-credit validator, outside this release.

Any key can use the available shared cache, bounded by the existing global byte
and entry budgets (32 MiB and 500 entries by default). Under global pressure a
hosted writer replaces its own older entries before another key's data. Several
keys can still cause eviction; pages are not guaranteed to survive until expiry.
Local stdio keeps its existing cache policy. A snapshot above global cache capacity
fails locally without another API request; credits may already have been used.

## Connect a client

Use a client that supports Streamable HTTP with a private custom header:

    X-IPGeolocation-API-Key: <your existing IPGeolocation API key>

Use HTTPS except for loopback development. Never put keys in URLs, query strings,
chat messages, tool arguments or committed configuration. The hosted process does
not use IPGEOLOCATION_API_KEY as a fallback and needs no operator-funded shared
key. Bearer/OAuth tokens are not accepted instead of this header. OAuth sign-in
is outside this release.

For the TypeScript MCP SDK, load the key from private runtime configuration:

    const transport = new StreamableHTTPClientTransport(
      new URL("https://mcp.ipgeolocation.io/mcp"),
      { requestInit: { redirect: "error", headers: {
        "X-IPGeolocation-API-Key": process.env.IPGEOLOCATION_API_KEY
      } } }
    );
    await client.connect(transport);

The SDK handles initialization and subsequent Mcp-Session-Id/protocol headers.
Every authenticated request must include the same API key. A connection ID is
random, signed and bound to that key and the negotiated protocol version. It
cannot replace the key or authorize a different account. IDs remain valid until
the worker restarts; restart returns 404 and clients may need to reconnect.

Idle connections occupy no session records and cannot evict another connection.
Each POST uses a fresh SDK server/transport and the shared tool implementation.
Only active requests are tracked, with IDs scoped to their signed connection.
Cancellation stops the matching request and preserves other calls and the
connection. Cancelled or interrupted calls are never automatically repeated;
API credits may already have been used.

DELETE returns the protocol-permitted 405: there is no idle session record to
terminate or revoke. The SDK accepts 405 and forgets its connection ID. To stop
active work, use MCP cancellation or close the client. GET streams, JSON-RPC
batches, WebSockets and Expect handshakes are unsupported. POST carries one MCP
message; accepted notifications return 202. /health supports GET and HEAD.

## Run locally

    npm ci --ignore-scripts
    npm run build
    IPGEOLOCATION_MCP_PUBLIC_URL=http://127.0.0.1:8787/mcp npm run start:http

Or install the next release and run ipgeolocation-io-mcp-http. The existing
ipgeolocation-io-mcp command continues to use stdio. Both belong to one package.

## Configuration and service capacity

| Variable | Default | Purpose |
| --- | --- | --- |
| IPGEOLOCATION_MCP_HTTP_HOST | 127.0.0.1 | Bind address; use 0.0.0.0 inside the isolated container |
| IPGEOLOCATION_MCP_HTTP_PORT | 8787 | Listener port |
| IPGEOLOCATION_MCP_PUBLIC_URL | https://mcp.ipgeolocation.io/mcp | Exact endpoint; HTTPS outside loopback |
| IPGEOLOCATION_MCP_ALLOWED_ORIGINS | Endpoint origin | Additional exact browser origins; never a wildcard |
| IPGEOLOCATION_MCP_TRUSTED_PROXIES | 127.0.0.1, ::1 | Exact proxy peer addresses allowed to supply X-Real-IP for request logs; the Compose example adds its host gateway |
| IPGEOLOCATION_MCP_HTTP_CONCURRENCY | 32 | Global executing-request capacity |

There are no per-customer session, concurrency, cache or upload allowances. The
following service-wide bounds protect the process, independently of account
usage. A full execution pool returns 503 with Retry-After; it does not spend an
upstream credit. Cancellation has its own small-message path and works while
ordinary execution is full.

- Existing shared validation, bulk, upstream-response and tool-argument bounds
  still apply. HTTP bodies are capped at six times the tool-argument byte limit
  plus 128 KiB, at most 32 MiB. Initialization/control messages are capped at 64 KiB.
- Small bodies have a separate global buffer budget from large bodies. Large
  uploads can retain at most twice the configured HTTP body limit in aggregate.
  Incomplete uploads occupy receiving capacity, never execution slots.
- The receiving pool and socket capacity are each max(256,2*concurrency+64).
  Small-buffer capacity is (socket capacity+concurrency)*64 KiB. These are
  process-wide memory bounds, not quotas keyed to customer or source address.
- Headers are capped at 16 KiB; JSON nesting at 64 levels and 100000 entries.
  Compressed requests are rejected. Once forwarded to the application, incomplete
  bodies time out within five seconds. Nginx separately allows ten seconds
  between client upload reads; that is not a total upload deadline.
  After upload, execution gets IPGEOLOCATION_REQUEST_TIMEOUT_MS plus
  five seconds. Shutdown drains for five seconds, then aborts work and sockets.

Finite infrastructure can still run out of capacity under sufficiently large
traffic. Tune global bounds against measured memory/CPU, monitor 503 responses, and plan
capacity for the real workload. Raising concurrency also requires more memory.

## Deploy behind Nginx and Cloudflare

Use [Compose](deploy/hosted.compose.yml), the [environment example](deploy/hosted.env.example)
and the [Nginx example](deploy/hosted.nginx.conf). Copy hosted.env.example to the
ignored deploy/hosted.env and review the global settings. Only loopback publishes
the application port; Nginx supplies HTTPS and forwards to that private port.
These templates and the Docker build context belong to the matching repository
source checkout; they are not installed by the npm package.

The Nginx example serves the connection guide at `/`. Install its static page:

    sudo install -d -m 0755 /var/www/ipgeolocation-mcp
    sudo install -o root -g root -m 0644 deploy/hosted.index.html /var/www/ipgeolocation-mcp/index.html

Keep the inline style and script hashes in the root location's Content Security
Policy matched to this HTML file when changing it. The page takes no API keys;
customers configure their key in their MCP client. `/mcp` remains the protocol
endpoint, and unrecognized paths remain unavailable.

Nginx buffers complete request bodies before sending them to the application;
response buffering and caching stay off. Create /var/cache/nginx/mcp_body on a
**dedicated, size-bounded filesystem**, for example a 128 MiB tmpfs, owned and
writable only by the Nginx worker account. Confirm this directory and its quota
on the actual host. Do not let temporary uploads fill a shared root disk. The
example accepts up to 32 MiB; the application enforces its configured lower bound.
The container tests use a bounded 128 MiB temporary filesystem.

Request logs contain UTC timestamps, request IDs, client/peer IPs and response
status/timing, including interrupted requests. They omit URLs, keys, cookies,
authorization values and request bodies. Only an exact trusted proxy peer may
supply one valid X-Real-IP value; other forwarded claims are ignored. This
logging metadata never authenticates a caller or affects account usage.

Cloudflare proxying can stay enabled; this service does not need OpenAI mTLS.
Use Full (strict) TLS, bypass caching and browser challenges for /mcp, and preserve
custom key, session and protocol headers. Restrict direct origin access to trusted
ingress. Proxy/Cloudflare logs must not collect keys or bodies; the example access
log omits URLs, keys and payloads. With Cloudflare, configure Nginx real_ip_header
CF-Connecting-IP and set_real_ip_from using only
[Cloudflare's current ranges](https://www.cloudflare.com/ips/), and keep those
ranges updated. This verifies the source of the header; it is not an IP block
list. Direct requests must not be able to forge the logged client IP. Nginx then
overwrites X-Real-IP with its verified remote address before forwarding to the
private application. Do not trust every private-network address as a proxy.

Use one worker initially. Signed connection IDs and active cancellation routing
are worker-local; multiple workers need affinity and a separate scaling design.
Cache/pages are process-local and disappear on restart, eviction or expiry. A
missing cached page never starts a replacement paid lookup.

API accounts with an IP allow-list must allow the hosted service's outbound IP.
API calls originate from this service; Cloudflare protects ingress and does not
change the source of outgoing API connections. Use separate outbound networking
if the origin's IP must remain concealed.

Before launch, verify actual DNS/TLS/Cloudflare, client custom-header support,
body-temp storage, restart/reconnect, monitoring and rollback on the target host.
Repository and local container tests cannot establish those deployment properties.

## Verification and release

    npm test
    npm audit
    npm run test:hosted:load
    npm run test:hosted:docker

The offline suite uses real loopback HTTP connections and provider fixtures. It
covers every retained tool against local MCP, API/key/cache/page isolation,
provider errors, signed IDs, typed request IDs, cancellation, shutdown, no timed
quota, two slow large uploads and 32 one-byte slow uploads. No external API is
called by these tests.

The load test runs 32 concurrent near 8 MiB provider responses in a separate process
with a 512 MiB heap, asserting success and headroom for the example 1 GiB container.
It is a resource regression, not a capacity guarantee for every workload.

The Docker suite requires a built runtime image (MCP_DOCKER_IMAGE, default
ipgeolocation-io-mcp:security-test), Docker with Buildx, Compose and OpenSSL. It
uses a temporary CA with hostname verification and real Nginx, then separately
copies the shipped Compose configuration and tests host-network Nginx through
the published loopback port. It does not test a deployed Cloudflare edge.

Live tests are explicit opt-in: privately set IPGEOLOCATION_LIVE_FREE_KEY and
IPGEOLOCATION_LIVE_PAID_KEY, then run npm run test:hosted:live. Successful calls
consume those accounts' credits. The script does not store or print keys. The
Docker suite also runs live tools through HTTPS when those variables are set.

Hosted support is additive in this same repository/package. Recommend a 2.1.0
minor release after review and release checks. Keep stdio registry records until
a remote URL is deployed and independently verified. Implementation does not
publish a release, change DNS or submit a listing.
