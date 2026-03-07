import test from "node:test";
import assert from "node:assert/strict";

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

test("getIpGeolocation sends apiKey and query params", async (t) => {
  clearClientEnv();
  process.env.IPGEOLOCATION_API_KEY = "test_api_key_local";
  const originalFetch = globalThis.fetch;
  t.after(() => {
    clearClientEnv();
    globalThis.fetch = originalFetch;
  });

  let capturedUrl;
  let capturedMethod;
  globalThis.fetch = async (url, options = {}) => {
    capturedUrl = new URL(url);
    capturedMethod = options.method || "GET";
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
  assert.equal(capturedUrl.searchParams.get("apiKey"), "test_api_key_local");
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
  globalThis.fetch = async (url) => {
    capturedUrl = new URL(url);
    return jsonResponse({ ip: "198.51.100.10" });
  };

  const client = await import(clientModuleUrl());
  const ip = await client.getMyIp();

  assert.equal(ip, "198.51.100.10");
  assert.equal(capturedUrl.pathname, "/v3/getip");
  assert.equal(capturedUrl.searchParams.get("apiKey"), null);
});

test("maps AbortError to ApiError 504 timeout", async (t) => {
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
      assert.equal(error.status, 504);
      assert.match(error.message, /timed out/);
      return true;
    }
  );
});

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
      assert.match(error.message, /Failed to reach upstream API/);
      return true;
    }
  );
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
      assert.match(error.message, /truncated upstream error body/);
      assert.ok(error.message.length < 4300);
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
      assert.match(error.message, /invalid JSON/);
      return true;
    }
  );
});
