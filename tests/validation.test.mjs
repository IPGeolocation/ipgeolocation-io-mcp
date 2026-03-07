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
  assert.match(validateElevation("-1", "elevation"), /between 0 and 10000/);
  assert.match(validateElevation("10001", "elevation"), /between 0 and 10000/);
  assert.match(validateElevation("abc", "elevation"), /between 0 and 10000/);
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
