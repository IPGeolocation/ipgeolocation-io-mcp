import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

const NUM_RUNS = 1_000;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;

function distModuleUrl(relativePath) {
  const url = new URL(`../dist/${relativePath}`, import.meta.url);
  url.searchParams.set("t", `${Date.now()}-${Math.random()}`);
  return url.href;
}

const latitudeArbitrary = fc.double({
  min: -90,
  max: 90,
  noDefaultInfinity: true,
  noNaN: true,
});

const longitudeArbitrary = fc.double({
  min: -180,
  max: 180,
  noDefaultInfinity: true,
  noNaN: true,
});

const invalidLatitudeArbitrary = fc.oneof(
  fc.double({
    min: -Number.MAX_VALUE,
    max: -90,
    maxExcluded: true,
    noDefaultInfinity: true,
    noNaN: true,
  }),
  fc.double({
    min: 90,
    minExcluded: true,
    max: Number.MAX_VALUE,
    noDefaultInfinity: true,
    noNaN: true,
  })
);

const invalidLongitudeArbitrary = fc.oneof(
  fc.double({
    min: -Number.MAX_VALUE,
    max: -180,
    maxExcluded: true,
    noDefaultInfinity: true,
    noNaN: true,
  }),
  fc.double({
    min: 180,
    minExcluded: true,
    max: Number.MAX_VALUE,
    noDefaultInfinity: true,
    noNaN: true,
  })
);

const validDateArbitrary = fc.date({
  min: new Date(Date.UTC(2000, 0, 1)),
  max: new Date(Date.UTC(2099, 8, 30)),
  noInvalidDate: true,
});

const apiKeyUnit = fc.constantFrom(
  ..."0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_"
);
const encodedApiKeyUnit = fc.constantFrom("/", "+", "=", "?", "&", "%", "#", ":");
const apiKeyArbitrary = fc.oneof(
  fc.string({ unit: apiKeyUnit, minLength: 16, maxLength: 64 }),
  fc
    .tuple(
      fc.string({ unit: apiKeyUnit, minLength: 15, maxLength: 48 }),
      encodedApiKeyUnit,
      fc.string({ unit: apiKeyUnit, maxLength: 15 })
    )
    .map(([prefix, encodedCharacter, suffix]) => {
      return `${prefix}${encodedCharacter}${suffix}`;
    })
);

test("fuzz: valid coordinate pairs are always accepted", async () => {
  const { validateCoordinatePair } = await import(
    distModuleUrl("tools/validation.js")
  );

  fc.assert(
    fc.property(latitudeArbitrary, longitudeArbitrary, (latitude, longitude) => {
      assert.equal(
        validateCoordinatePair(String(latitude), String(longitude), "lookup_ip"),
        null
      );
    }),
    { numRuns: NUM_RUNS }
  );
});

test("fuzz: out-of-range coordinates are always rejected", async () => {
  const { validateCoordinatePair } = await import(
    distModuleUrl("tools/validation.js")
  );

  fc.assert(
    fc.property(
      invalidLatitudeArbitrary,
      longitudeArbitrary,
      (latitude, longitude) => {
        assert.match(
          validateCoordinatePair(
            String(latitude),
            String(longitude),
            "lookup_ip"
          ),
          /between -90 and 90/
        );
      }
    ),
    { numRuns: NUM_RUNS }
  );

  fc.assert(
    fc.property(
      latitudeArbitrary,
      invalidLongitudeArbitrary,
      (latitude, longitude) => {
        assert.match(
          validateCoordinatePair(
            String(latitude),
            String(longitude),
            "lookup_ip"
          ),
          /between -180 and 180/
        );
      }
    ),
    { numRuns: NUM_RUNS }
  );
});

test("fuzz: valid date ranges up to 90 days are always accepted", async () => {
  const { validateDateRange } = await import(
    distModuleUrl("tools/validation.js")
  );

  fc.assert(
    fc.property(
      validDateArbitrary,
      fc.integer({ min: 0, max: 90 }),
      (start, daySpan) => {
        const end = new Date(start.getTime() + daySpan * MILLISECONDS_PER_DAY);
        const dateStart = start.toISOString().slice(0, 10);
        const dateEnd = end.toISOString().slice(0, 10);

        assert.equal(validateDateRange(dateStart, dateEnd, 90), null);
      }
    ),
    { numRuns: NUM_RUNS }
  );
});

test("fuzz: configured API keys never survive redaction", async (t) => {
  const originalApiKey = process.env.IPGEOLOCATION_API_KEY;
  t.after(() => {
    if (originalApiKey === undefined) {
      delete process.env.IPGEOLOCATION_API_KEY;
    } else {
      process.env.IPGEOLOCATION_API_KEY = originalApiKey;
    }
  });

  const { redactSensitiveText } = await import(distModuleUrl("redaction.js"));

  fc.assert(
    fc.property(apiKeyArbitrary, (apiKey) => {
      process.env.IPGEOLOCATION_API_KEY = apiKey;
      const encodedApiKey = encodeURIComponent(apiKey);
      const doubleEncodedApiKey = encodeURIComponent(encodedApiKey);
      const redacted = redactSensitiveText(
        [
          `raw=${apiKey}`,
          `?apiKey=${apiKey}`,
          `x-ipgeolocation-api-key: ${apiKey}`,
          `apiKey%3D${encodedApiKey}%26ip%3D8.8.8.8`,
          `double=${doubleEncodedApiKey}`,
        ].join("\n")
      );

      assert.equal(redacted.includes(apiKey), false);
      assert.equal(redacted.includes(encodedApiKey), false);
      assert.equal(redacted.includes(doubleEncodedApiKey), false);
      assert.match(redacted, /\[REDACTED_API_KEY\]/);
    }),
    { numRuns: NUM_RUNS }
  );
});
