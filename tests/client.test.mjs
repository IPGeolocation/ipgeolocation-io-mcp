import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { errorToolResponse } from "../dist/tools/response.js";

const CLIENT_ENV_KEYS = [
  "IPGEOLOCATION_API_KEY",
  "IPGEOLOCATION_REQUEST_TIMEOUT_MS",
];

function clientModuleUrl() {
  const url = new URL("../dist/client.js", import.meta.url);
  url.searchParams.set("t", `${Date.now()}-${Math.random()}`);
  return url.href;
}

function clearClientEnv() {
  for (const key of CLIENT_ENV_KEYS) {
    delete process.env[key];
  }
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("getIpGeolocation throws when API key is not configured", async (t) => {
  clearClientEnv();
  const originalFetch = globalThis.fetch;
  t.after(() => {
    clearClientEnv();
    globalThis.fetch = originalFetch;
  });

  const client = await import(clientModuleUrl());
  await assert.rejects(
    () => client.getIpGeolocation({ ip: "8.8.8.8" }),
    /API key not configured/
  );
});

test("getIpGeolocation sends API key in a header and keeps it out of the URL", async (t) => {
  clearClientEnv();
  process.env.IPGEOLOCATION_API_KEY = "test_api_key_local";
  const originalFetch = globalThis.fetch;
  t.after(() => {
    clearClientEnv();
    globalThis.fetch = originalFetch;
  });

  let capturedUrl;
  let capturedMethod;
  let capturedHeaders;
  globalThis.fetch = async (url, options = {}) => {
    capturedUrl = new URL(url);
    capturedMethod = options.method || "GET";
    capturedHeaders = new Headers(options.headers);
    return jsonResponse({ ok: true });
  };

  const client = await import(clientModuleUrl());
  const result = await client.getIpGeolocation({
    ip: "8.8.8.8",
    fields: "location.city",
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(capturedMethod, "GET");
  assert.equal(capturedUrl.pathname, "/v3/ipgeo");
  assert.equal(capturedUrl.searchParams.get("apiKey"), null);
  assert.equal(
    capturedHeaders.get("x-ipgeolocation-api-key"),
    "test_api_key_local"
  );
  assert.equal(capturedUrl.searchParams.get("ip"), "8.8.8.8");
  assert.equal(capturedUrl.searchParams.get("fields"), "location.city");
});

test("getMyIp does not include API key in request", async (t) => {
  clearClientEnv();
  process.env.IPGEOLOCATION_API_KEY = "test_api_key_local";
  const originalFetch = globalThis.fetch;
  t.after(() => {
    clearClientEnv();
    globalThis.fetch = originalFetch;
  });

  let capturedUrl;
  let capturedHeaders;
  globalThis.fetch = async (url, options = {}) => {
    capturedUrl = new URL(url);
    capturedHeaders = new Headers(options.headers);
    return jsonResponse({ ip: "198.51.100.10" });
  };

  const client = await import(clientModuleUrl());
  const ip = await client.getMyIp();

  assert.equal(ip, "198.51.100.10");
  assert.equal(capturedUrl.pathname, "/v3/getip");
  assert.equal(capturedUrl.searchParams.get("apiKey"), null);
  assert.equal(capturedHeaders.get("x-ipgeolocation-api-key"), null);
});

test("getMyIp preserves upstream non-ok error messages", async (t) => {
  clearClientEnv();
  const originalFetch = globalThis.fetch;
  t.after(() => {
    clearClientEnv();
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () =>
    jsonResponse({ error: "Too many requests for this API key." }, 429);

  const client = await import(clientModuleUrl());
  await assert.rejects(
    () => client.getMyIp(),
    (error) => {
      assert.equal(error.name, "ApiError");
      assert.equal(error.status, 429);
      assert.equal(error.source, "ipgeolocation_api");
      assert.equal(error.message, "429: Too many requests for this API key.");
      return true;
    }
  );
});

test("getMyIp validates provider responses without echoing arbitrary data", async (t) => {
  clearClientEnv();
  const originalFetch = globalThis.fetch;
  t.after(() => {
    clearClientEnv();
    globalThis.fetch = originalFetch;
  });
  const client = await import(clientModuleUrl());
  for (const payload of [null, [], {}, { ip: null }, { ip: 123 }, { ip: "" }, { ip: "unexpected-provider-data" }]) {
    globalThis.fetch = async () => jsonResponse(payload);
    await assert.rejects(() => client.getMyIp(), error => {
      assert.equal(error.name, "ApiError");
      assert.equal(error.status, 502);
      assert.equal(error.source, "mcp_server");
      assert.match(error.message, payload === null || Array.isArray(payload) ? /invalid response.*JSON object/ : /invalid getip response.*IPv4 or IPv6/);
      assert.doesNotMatch(error.message, /unexpected-provider-data/);
      return true;
    });
  }
  for (const ip of ["8.8.8.8", "2001:4860:4860::8888"]) {
    globalThis.fetch = async () => jsonResponse({ ip });
    assert.equal(await client.getMyIp(), ip);
  }
});

test("does not report a timeout for an AbortError before the deadline", async (t) => {
  clearClientEnv();
  process.env.IPGEOLOCATION_API_KEY = "test_api_key_local";
  process.env.IPGEOLOCATION_REQUEST_TIMEOUT_MS = "1000";
  const originalFetch = globalThis.fetch;
  t.after(() => {
    clearClientEnv();
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    throw error;
  };

  const client = await import(clientModuleUrl());
  await assert.rejects(
    () => client.getSecurity({ ip: "8.8.8.8" }),
    (error) => {
      assert.equal(error.name, "ApiError");
      assert.equal(error.status, 502);
      assert.equal(error.source, "mcp_server");
      assert.match(error.message, /Upstream request or response failed.*aborted/);
      assert.doesNotMatch(error.message, /timed out/);
      return true;
    }
  );
});

for (const method of ["getIpGeolocation", "getMyIp"]) {
  for (const status of [200, 401, 429]) {
    test(`${method} retains the deadline and received HTTP ${status} status during a slow body`, async (t) => {
      clearClientEnv();
      process.env.IPGEOLOCATION_API_KEY = "test_api_key_local";
      process.env.IPGEOLOCATION_REQUEST_TIMEOUT_MS = "1000";
      const originalFetch = globalThis.fetch;
      let requests = 0;
      const server = createServer((_request, response) => {
        requests++;
        response.writeHead(status, { "content-type": "application/json" });
        response.flushHeaders();
        const bodyTimer = setTimeout(() => {
          response.end(JSON.stringify({ ip: "8.8.8.8", message: "Unauthorized" }));
        }, 1500);
        response.on("close", () => clearTimeout(bodyTimer));
      });
      t.after(async () => {
        clearClientEnv();
        globalThis.fetch = originalFetch;
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      globalThis.fetch = (_url, options) =>
        originalFetch(`http://127.0.0.1:${server.address().port}/slow-body`, options);

      const client = await import(clientModuleUrl());
      await assert.rejects(
        () => client[method]({ ip: "8.8.8.8" }),
        (error) => {
          assert.equal(error.name, "ApiError");
          assert.equal(error.status, status === 200 ? 504 : status);
          assert.equal(error.source, status === 200 ? "mcp_server" : "ipgeolocation_api");
          assert.match(error.message, status === 200 ? /timed out after 1000ms/ : /error body was unavailable.*HTTP status is preserved/);
          const detail = errorToolResponse(error).structuredContent.error;
          assert.equal(detail.retryable, false);
          if (status === 200) {
            assert.equal(error.code, "response_incomplete");
            assert.match(detail.guidance, /Do not retry automatically/);
          }
          return true;
        }
      );
      assert.equal(requests, 1, "a body deadline must not issue another upstream request");
    });
  }
}

test("maps generic fetch failures to ApiError 502", async (t) => {
  clearClientEnv();
  process.env.IPGEOLOCATION_API_KEY = "test_api_key_local";
  const originalFetch = globalThis.fetch;
  t.after(() => {
    clearClientEnv();
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => {
    throw new Error("offline");
  };

  const client = await import(clientModuleUrl());
  await assert.rejects(
    () => client.getTimezone({ ip: "8.8.8.8" }),
    (error) => {
      assert.equal(error.name, "ApiError");
      assert.equal(error.status, 502);
      assert.equal(error.source, "mcp_server");
      assert.match(error.message, /Upstream request or response failed/);
      assert.match(error.message, /API may already have processed.*no automatic retry/);
      return true;
    }
  );
});

test("a disconnected response warns about processed requests without retrying", async (t) => {
  clearClientEnv();
  process.env.IPGEOLOCATION_API_KEY = "body-disconnect-synthetic-key";
  const originalFetch = globalThis.fetch;
  let processed = 0;
  const server = createServer((request, response) => {
    processed++;
    request.resume();
    response.writeHead(200, { "content-type": "application/json" });
    response.write('{"ip":"8.8.8.8","company":');
    const timer = setTimeout(() => response.destroy(), 25);
    response.on("close", () => clearTimeout(timer));
  });
  t.after(async () => {
    clearClientEnv();
    globalThis.fetch = originalFetch;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  globalThis.fetch = (url, options) => {
    assert.equal(new URL(url).origin, "https://api.ipgeolocation.io");
    return originalFetch(`http://127.0.0.1:${server.address().port}/v3/ipgeo`, options);
  };
  const client = await import(clientModuleUrl());
  await assert.rejects(() => client.getIpGeolocation({ ip: "8.8.8.8" }), error => {
    assert.equal(error.status, 502);
    assert.equal(error.source, "mcp_server");
    assert.equal(error.code, "response_incomplete");
    assert.match(error.message, /success status.*response was interrupted/);
    assert.match(error.message, /Credits may already have been used.*new request may use credits again/);
    assert.match(error.message, /No automatic retry/);
    assert.equal(errorToolResponse(error).structuredContent.error.retryable, false);
    assert.doesNotMatch(error.message, /body-disconnect-synthetic-key/);
    return true;
  });
  assert.equal(processed, 1);
});

test("returns truncated upstream error body for non-ok responses", async (t) => {
  clearClientEnv();
  process.env.IPGEOLOCATION_API_KEY = "test_api_key_local";
  const originalFetch = globalThis.fetch;
  t.after(() => {
    clearClientEnv();
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () =>
    new Response("z".repeat(10000), {
      status: 500,
      statusText: "Internal Server Error",
    });

  const client = await import(clientModuleUrl());
  await assert.rejects(
    () => client.getAsn({ asn: "AS13335" }),
    (error) => {
      assert.equal(error.name, "ApiError");
      assert.equal(error.status, 500);
      assert.equal(error.source, "ipgeolocation_api");
      assert.match(error.message, /truncated upstream error body/);
      assert.ok(error.message.length < 4300);
      return true;
    }
  );
});

test("returns upstream JSON error message for auth failures", async (t) => {
  clearClientEnv();
  process.env.IPGEOLOCATION_API_KEY = "expired_api_key";
  const originalFetch = globalThis.fetch;
  t.after(() => {
    clearClientEnv();
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () =>
    jsonResponse(
      {
        message:
          "Provided API key is not valid. Contact technical support for assistance at support@ipgeolocation.io",
      },
      401
    );

  const client = await import(clientModuleUrl());
  await assert.rejects(
    () => client.getIpGeolocation({ ip: "8.8.8.8" }),
    (error) => {
      assert.equal(error.name, "ApiError");
      assert.equal(error.status, 401);
      assert.equal(error.source, "ipgeolocation_api");
      assert.equal(
        error.message,
        "401: Provided API key is not valid. Contact technical support for assistance at support@ipgeolocation.io"
      );
      return true;
    }
  );
});

test("redacts API keys from upstream error messages", async (t) => {
  clearClientEnv();
  process.env.IPGEOLOCATION_API_KEY = "sensitive_test_key_123";
  const originalFetch = globalThis.fetch;
  t.after(() => {
    clearClientEnv();
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () =>
    jsonResponse(
      {
        message:
          "Request rejected for https://api.ipgeolocation.io/v3/ipgeo?apiKey=sensitive_test_key_123&ip=8.8.8.8; x-ipgeolocation-api-key: unexpected_header_secret_789",
      },
      401
    );

  const client = await import(clientModuleUrl());
  await assert.rejects(
    () => client.getIpGeolocation({ ip: "8.8.8.8" }),
    (error) => {
      assert.equal(error.name, "ApiError");
      assert.equal(error.status, 401);
      assert.doesNotMatch(error.message, /sensitive_test_key_123/);
      assert.doesNotMatch(error.message, /unexpected_header_secret_789/);
      assert.match(error.message, /apiKey=\[REDACTED_API_KEY\]/);
      assert.match(
        error.message,
        /x-ipgeolocation-api-key: \[REDACTED_API_KEY\]/
      );
      return true;
    }
  );
});

test("redacts API keys from transport failures", async (t) => {
  clearClientEnv();
  process.env.IPGEOLOCATION_API_KEY = "sensitive_test_key_456";
  const originalFetch = globalThis.fetch;
  t.after(() => {
    clearClientEnv();
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => {
    throw new Error(
      "fetch failed for x-ipgeolocation-api-key: sensitive_test_key_456 while connecting"
    );
  };

  const client = await import(clientModuleUrl());
  await assert.rejects(
    () => client.getSecurity({ ip: "8.8.8.8" }),
    (error) => {
      assert.equal(error.name, "ApiError");
      assert.equal(error.status, 502);
      assert.equal(error.source, "mcp_server");
      assert.doesNotMatch(error.message, /sensitive_test_key_456/);
      assert.match(error.message, /\[REDACTED_API_KEY\]/);
      return true;
    }
  );
});

test("maps invalid JSON response bodies to ApiError 502", async (t) => {
  clearClientEnv();
  process.env.IPGEOLOCATION_API_KEY = "test_api_key_local";
  const originalFetch = globalThis.fetch;
  t.after(() => {
    clearClientEnv();
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () =>
    new Response("not-json", {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  const client = await import(clientModuleUrl());
  await assert.rejects(
    () => client.getAstronomy({ ip: "8.8.8.8" }),
    (error) => {
      assert.equal(error.name, "ApiError");
      assert.equal(error.status, 502);
      assert.equal(error.source, "mcp_server");
      assert.match(error.message, /invalid JSON/);
      return true;
    }
  );
});

test("direct clients reject non-string field selectors before fetching", async t => {
  clearClientEnv();
  const originalFetch = globalThis.fetch;
  t.after(() => { clearClientEnv(); globalThis.fetch = originalFetch; });
  process.env.IPGEOLOCATION_API_KEY = "selector-normalization-synthetic-key";
  let calls = 0;
  globalThis.fetch = async () => { calls++; return jsonResponse({}); };
  const client = await import(clientModuleUrl());
  for (const method of ["getIpGeolocation", "getSecurity", "getAbuseContact", "getAsn"]) {
    for (const name of ["fields", "excludes"]) {
      for (const value of [null, 1, false, [], {}]) {
        await assert.rejects(client[method]({ ip: "8.8.8.8", [name]: value }), new RegExp(`'${name}' must be a string`));
      }
    }
  }
  assert.equal(calls, 0);
});

test("tool cache aliases and forced refreshes use identical upstream field selectors", async t => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { createMcpServer } = await import("../dist/index.js");
  const { clearToolCacheForTests } = await import("../dist/tools/cache.js");
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; clearToolCacheForTests(); });
  const fields = "security.is_vpn,security.threat_score,security.threat_score";
  const excludes = "security.is_proxy,security.is_tor";
  const padded = { fields: " security.threat_score, security.is_vpn ,, security.threat_score ", excludes: " security.is_tor, ,security.is_proxy " };
  for (const [name, args] of [
    ["lookup_ip", { ip: "8.8.8.8", include: "security" }],
    ["bulk_lookup_ip", { ips: ["8.8.8.8"], include: "security" }],
    ["bulk_security_check", { ips: ["8.8.8.8"] }],
  ]) {
    clearToolCacheForTests();
    const requests = [];
    globalThis.fetch = async url => {
      const request = new URL(url);
      assert.equal(request.origin, "https://api.ipgeolocation.io");
      requests.push({ fields: request.searchParams.get("fields"), excludes: request.searchParams.get("excludes") });
      const row = { ip: "8.8.8.8", security: { is_vpn: false, threat_score: 0 } };
      return jsonResponse(name.startsWith("bulk_") ? [row] : row);
    };
    const server = createMcpServer({ apiKey: "selector-normalization-synthetic-key" });
    const client = new Client({ name: "selector-normalization", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(b); await client.connect(a);
      const call = selectors => client.callTool({ name, arguments: { ...args, ...selectors } });
      const cold = await call(padded);
      assert.equal(cold.isError, undefined);
      assert.deepEqual(requests, [{ fields, excludes }], name);
      const warm = await call({ fields, excludes });
      assert.deepEqual(warm.structuredContent, cold.structuredContent);
      assert.equal(requests.length, 1, name);
      assert.equal((await call({ ...padded, force_refresh: true })).isError, undefined);
      assert.deepEqual(requests, [{ fields, excludes }, { fields, excludes }], name);
      clearToolCacheForTests();
      assert.equal((await call({ fields, excludes })).isError, undefined);
      assert.deepEqual(requests, Array.from({ length: 3 }, () => ({ fields, excludes })), name);
    } finally { await client.close(); await server.close(); }
  }
});
