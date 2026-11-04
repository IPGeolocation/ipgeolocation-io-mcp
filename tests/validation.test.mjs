import test from "node:test";
import assert from "node:assert/strict";

function validationModuleUrl() {
  const url = new URL("../dist/tools/validation.js", import.meta.url);
  url.searchParams.set("t", `${Date.now()}-${Math.random()}`);
  return url.href;
}

test("validateCoordinatePair enforces lat/long pairing", async () => {
  const { validateCoordinatePair } = await import(validationModuleUrl());

  assert.equal(validateCoordinatePair(undefined, undefined, "tool"), null);
  assert.equal(validateCoordinatePair("40.7", "-74.0", "tool"), null);
  assert.match(
    validateCoordinatePair("40.7", undefined, "tool"),
    /lat.*long.*provided together/
  );
  assert.match(
    validateCoordinatePair(undefined, "-74.0", "tool"),
    /lat.*long.*provided together/
  );
  assert.match(validateCoordinatePair("91", "74.0", "tool"), /between -90 and 90/);
  assert.match(
    validateCoordinatePair("40.7", "-181", "tool"),
    /between -180 and 180/
  );
});

test("validateCoordinatePairNamed enforces named pair requirements", async () => {
  const { validateCoordinatePairNamed } = await import(validationModuleUrl());

  assert.equal(
    validateCoordinatePairNamed(
      "40.7",
      "-74.0",
      "lat_from",
      "long_from",
      "convert_timezone"
    ),
    null
  );

  const message = validateCoordinatePairNamed(
    "40.7",
    undefined,
    "lat_from",
    "long_from",
    "convert_timezone"
  );
  assert.match(message, /lat_from/);
  assert.match(message, /long_from/);
});

test("validateIsoDate validates YYYY-MM-DD format", async () => {
  const { validateIsoDate } = await import(validationModuleUrl());

  assert.equal(validateIsoDate(undefined, "date"), null);
  assert.equal(validateIsoDate("2026-03-05", "date"), null);
  assert.equal(validateIsoDate(" 2026-03-05 ", "date"), null);
  assert.equal(validateIsoDate("2024-02-29", "date"), null);
  assert.match(validateIsoDate("20260305", "date"), /YYYY-MM-DD/);
  assert.match(validateIsoDate("2023-02-29", "date"), /YYYY-MM-DD/);
  assert.match(validateIsoDate("2026-02-31", "date"), /YYYY-MM-DD/);
  assert.match(validateIsoDate("2026-15-99", "date"), /YYYY-MM-DD/);
});

test("validateDateRange enforces ordering and max range", async () => {
  const { validateDateRange } = await import(validationModuleUrl());

  assert.equal(validateDateRange("2026-01-01", "2026-03-31", 90), null);
  assert.match(
    validateDateRange("2026-01-02", "2026-01-01", 90),
    /greater than or equal/
  );
  assert.match(
    validateDateRange("2026-01-01", "2026-05-01", 90),
    /maximum allowed range/
  );
  assert.match(
    validateDateRange("20260101", "2026-01-10", 90),
    /dateStart must be in YYYY-MM-DD format/
  );
  assert.match(
    validateDateRange("2026-02-31", "2026-03-10", 90),
    /dateStart must be in YYYY-MM-DD format/
  );
});

test("hasAnyValue checks for non-empty values", async () => {
  const { hasAnyValue } = await import(validationModuleUrl());

  assert.equal(hasAnyValue([undefined, "   ", ""]), false);
  assert.equal(hasAnyValue([undefined, "UTC"]), true);
});

test("validateElevation enforces documented range", async () => {
  const { validateElevation } = await import(validationModuleUrl());

  assert.equal(validateElevation(undefined, "elevation"), null);
  assert.equal(validateElevation("0", "elevation"), null);
  assert.equal(validateElevation("10000", "elevation"), null);
  for (const value of ["-1", "-0.5", "-1e200"]) assert.equal(validateElevation(value, "elevation"), null);
  for (const value of ["10001", "abc", "Infinity", "-Infinity", "NaN"]) {
    assert.match(validateElevation(value, "elevation"), /finite number no greater than 10000/);
  }
});

test("negative finite elevations normalize to the same request value as zero", async () => {
  const { normalizeLookupArguments } = await import(validationModuleUrl());
  for (const value of ["-1", " -0.5 ", "-1e200", "-5e-324"]) {
    const args = { elevation: value };
    assert.equal(normalizeLookupArguments(args).elevation, "0");
    assert.equal(args.elevation, value);
  }
  for (const value of ["0", "0.5", "10000", "1e3", "-Infinity", "NaN"]) {
    assert.equal(normalizeLookupArguments({ elevation: value }).elevation, value);
  }
});

test("validateTimezoneConversionTime enforces documented formats", async () => {
  const { validateTimezoneConversionTime } = await import(validationModuleUrl());

  assert.equal(validateTimezoneConversionTime(undefined, "time"), null);
  assert.equal(
    validateTimezoneConversionTime("2026-03-05 10:30", "time"),
    null
  );
  assert.equal(
    validateTimezoneConversionTime("2026-03-05 10:30:59", "time"),
    null
  );
  assert.match(
    validateTimezoneConversionTime("2026-03-05T10:30:59", "time"),
    /yyyy-MM-dd HH:mm/
  );
  assert.match(
    validateTimezoneConversionTime("2026-03-05 24:00", "time"),
    /yyyy-MM-dd HH:mm/
  );
  assert.match(
    validateTimezoneConversionTime("2026-02-31 10:00", "time"),
    /yyyy-MM-dd HH:mm/
  );
});


test("date validation respects Gregorian leap years across the first century", async () => {
  const { validateIsoDate, validateDateRange } = await import(validationModuleUrl());
  assert.equal(validateIsoDate("0000-02-29", "date"), null);
  assert.equal(validateIsoDate("0099-12-31", "date"), null);
  assert.equal(validateDateRange("0099-12-31", "0100-01-01", 90), null);
  assert.match(validateIsoDate("0100-02-29", "date"), /YYYY-MM-DD/);
  assert.equal(validateIsoDate("0400-02-29", "date"), null);
  assert.match(validateDateRange("0099-12-31", "0100-04-01", 90), /90/);
});


test("lookup normalization rejects sparse direct-client bulk arrays", async () => {
  const { normalizeLookupArguments } = await import(validationModuleUrl());
  for (const name of ["ips", "uaStrings"]) {
    const rows = new Array(2); rows[0] = "8.8.8.8";
    assert.throws(() => normalizeLookupArguments({ [name]: rows }), /non-blank string/);
  }
});

test("lookup normalization aligns CSV selectors without altering case, duplicates or user agents", async () => {
  const { normalizeLookupArguments } = await import(validationModuleUrl());
  const uaString = "  Synthetic-UA/1.0, Company=Example\t😀  ";
  const args = {
    fields: " currency, Country.Code ,currency,, ",
    excludes: " location.city, Company.Name , location.city ",
    uaString,
    uaStrings: [uaString],
  };
  const normalized = normalizeLookupArguments(args);
  assert.equal(normalized.fields, "Country.Code,currency,currency");
  assert.equal(normalized.excludes, "Company.Name,location.city,location.city");
  assert.equal(normalized.uaString, uaString);
  assert.deepEqual(normalized.uaStrings, [uaString]);
  assert.equal(args.fields, " currency, Country.Code ,currency,, ");
  assert.equal(normalizeLookupArguments({ fields: " , , ", excludes: "" }).fields, "");
  assert.equal(normalizeLookupArguments({ fields: undefined }).fields, undefined);
  for (const name of ["fields", "excludes"]) {
    for (const value of [null, 1, false, [], {}]) {
      assert.throws(() => normalizeLookupArguments({ [name]: value }), new RegExp(`'${name}' must be a string`));
    }
  }
});

test("numeric configuration rejects partial, fractional and unsafe integer values", async t => {
  const { getRequestTimeoutMs } = await import("../dist/config.js");
  const name = "IPGEOLOCATION_REQUEST_TIMEOUT_MS", previous = process.env[name];
  t.after(() => previous === undefined ? delete process.env[name] : process.env[name] = previous);
  for (const value of ["30000ms", "30000.1", "30000junk", "-1", "Infinity", "9007199254740992"]) {
    process.env[name] = value;
    assert.equal(getRequestTimeoutMs(), 15000, value);
  }
  process.env[name] = " 30000 "; assert.equal(getRequestTimeoutMs(), 30000);
});

test("lookup normalization rejects unpaired Unicode surrogates without changing valid text", async () => {
  const { normalizeLookupArguments } = await import(validationModuleUrl());
  const broken = ["\ud800", "\udfff", "a\ud800b", "a\udc00b", "\udc00\ud800", "\ud800\ud800", "😀\udc00"];
  for (const value of broken) {
    for (const name of ["ip", "asn", "lang", "location", "fields", "excludes", "include", "uaString"]) {
      assert.throws(() => normalizeLookupArguments({ [name]: value }), /invalid Unicode text/);
    }
    for (const name of ["ips", "uaStrings"]) {
      assert.throws(() => normalizeLookupArguments({ [name]: ["valid", value] }), /invalid Unicode text/);
    }
  }
  for (const value of ["😀", "\ud800\udc00", "\udbff\udfff", "Lahore لاہور", "café", "literal \\ud800", "replacement �"]) {
    const args = { location: value, uaString: ` ${value} `, uaStrings: [` ${value} `] };
    assert.deepEqual(normalizeLookupArguments(args), args);
  }
});

test("Unicode validation agrees with the platform for generated UTF-16 strings", async () => {
  const { normalizeLookupArguments } = await import(validationModuleUrl());
  let seed = 0x28a6701d;
  for (let sample = 0; sample < 10000; sample++) {
    let value = "text:";
    for (let index = 0; index < 8; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      value += String.fromCharCode(seed & 0xffff);
    }
    if (value.isWellFormed()) assert.equal(normalizeLookupArguments({ uaString: value }).uaString, value);
    else assert.throws(() => normalizeLookupArguments({ uaString: value }), /invalid Unicode text/);
  }
});

test("all API tools reject broken Unicode locally before any request", async t => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { createMcpServer } = await import("../dist/index.js");
  const { clearToolCacheForTests } = await import("../dist/tools/cache.js");
  const { getMaxToolArgumentBytes } = await import("../dist/config.js");
  const previousFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("Unexpected upstream call in local Unicode validation test"); };
  clearToolCacheForTests();
  const server = createMcpServer({ apiKey: "unicode-validation-synthetic-key" });
  const client = new Client({ name: "unicode-validation", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); clearToolCacheForTests(); globalThis.fetch = previousFetch; });
  await server.connect(b); await client.connect(a);
  const broken = "input\ud800";
  const cases = [
    ...["lookup_ip", "lookup_company", "lookup_network", "lookup_currency", "check_security", "get_abuse_contact"].map(name => [name, { ip: broken }]),
    ["lookup_asn", { asn: broken }], ["get_timezone", { location: broken }],
    ["convert_timezone", { location_from: broken, tz_to: "UTC" }],
    ["get_astronomy", { location: broken }],
    ["get_astronomy_time_series", { ip: broken, dateStart: "2026-01-01", dateEnd: "2026-01-02" }],
    ["parse_user_agent", { uaString: broken }], ["bulk_parse_user_agent", { uaStrings: ["valid", broken] }],
    ["bulk_lookup_ip", { ips: ["8.8.8.8", broken] }], ["bulk_security_check", { ips: [broken] }],
    ...["fields", "excludes", "include"].map(name => ["lookup_ip", { ip: "8.8.8.8", [name]: broken }]),
  ];
  for (const [name, args] of cases) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, true, name);
    assert.equal(result.structuredContent.error.category, "validation", name);
    assert.equal(result.structuredContent.error.retryable, false, name);
    assert.match(result.structuredContent.error.message, /invalid Unicode text/, name);
    assert.equal(requests, 0, name);
  }
  for (const args of [{ ip: { nested: broken } }, { ips: [[broken]] }, { unknown: broken }, { [broken]: "value" }]) {
    const result = await client.callTool({ name: "lookup_ip", arguments: args });
    assert.equal(result.structuredContent.error.category, "validation");
    assert.equal(requests, 0);
  }
  const oversized = await client.callTool({ name: "parse_user_agent", arguments: { uaString: "x".repeat(getMaxToolArgumentBytes()) + broken } });
  assert.equal(oversized.structuredContent.error.category, "resource_limit", "byte limits must be checked before text validation");
  assert.equal(requests, 0);
});

test("direct clients reject broken Unicode and preserve valid URL and body text", async t => {
  const { getTimezone, getIpGeolocation, getIpGeolocationBulk, parseUserAgent, parseUserAgentBulk } = await import("../dist/client.js");
  const { withRuntimeConfig } = await import("../dist/config.js");
  const previousFetch = globalThis.fetch, requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: new URL(url), body: options.body ? JSON.parse(options.body) : undefined });
    return new Response(JSON.stringify({ timezone: "Synthetic", user_agent_string: "Synthetic" }));
  };
  t.after(() => { globalThis.fetch = previousFetch; });
  await withRuntimeConfig({ apiKey: "unicode-validation-synthetic-key" }, async () => {
    const broken = "input\udc00";
    for (const call of [
      () => getTimezone({ location: broken }), () => getIpGeolocation({ ip: broken }),
      () => getIpGeolocation({ include: broken }), () => getIpGeolocation({ fields: broken }),
      () => getIpGeolocationBulk({ ips: ["8.8.8.8", broken] }),
      () => parseUserAgent({ uaString: broken }), () => parseUserAgentBulk({ uaStrings: [broken] }),
    ]) await assert.rejects(call, /invalid Unicode text/);
    assert.equal(requests.length, 0);
    const location = "Lahore لاہور 😀", uaString = " Synthetic/1.0 😀 ";
    await getTimezone({ location });
    await parseUserAgent({ uaString });
    assert.equal(requests[0].url.searchParams.get("location"), location);
    assert.equal(requests[1].body.uaString, uaString);
  });
});
