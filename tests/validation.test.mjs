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
