import { getConfiguredApiKey } from "./config.js";

const REDACTED_API_KEY = "[REDACTED_API_KEY]";
const REDACTED_TOKEN = "[REDACTED_TOKEN]";
const WORD_CHARACTER = /[\p{L}\p{N}\p{M}_]/u;
const JSON_ESCAPE_CODE: Record<string, number> = { '"': 34, "\\": 92, "/": 47, b: 8, f: 12, n: 10, r: 13, t: 9 };
type SecretVariant = { value: string; percentDepth: 0 | 1 | 2 };
type Secrets = { value: string; variants: SecretVariant[]; short: boolean; jsonPrefix?: Uint32Array };

function configuredSecrets(): Secrets {
  const secret = getConfiguredApiKey();
  if (!secret) return { value: "", variants: [], short: false };
  const variants = new Map<string, SecretVariant>();
  const add = (value: string, percentDepth: 0 | 1 | 2 = 0) => {
    if (!variants.has(value)) variants.set(value, { value, percentDepth });
  };
  add(secret);
  const json = JSON.stringify(secret).slice(1, -1);
  add(json);
  add(json.replaceAll("/", "\\/"));
  add(JSON.stringify(json).slice(1, -1));
  try {
    const uri = encodeURIComponent(secret);
    const form = new URLSearchParams({ key: secret }).toString().slice(4);
    const escaped = Array.from(Buffer.from(secret, "utf8"), byte => `%${byte.toString(16).padStart(2, "0")}`).join("");
    for (const value of [uri, encodeURI(secret), form, escaped]) {
      add(value, 1);
      add(encodeURIComponent(value), 2);
    }
  } catch {
    // Malformed configuration must not disable literal or JSON secret redaction.
  }
  // Very short secrets would otherwise rewrite ordinary words and field names.
  return { value: secret, variants: [...variants.values()].sort((a, b) => b.value.length - a.value.length), short: !/^.{4}/su.test(secret) };
}

function normalizeEscapes(text: string, variant: SecretVariant): string {
  if (variant.percentDepth === 0) return text;
  const pattern = variant.percentDepth === 2 ? /%25[\da-f]{2}|%[\da-f]{2}/gi : /%[\da-f]{2}/gi;
  return text.replace(pattern, value => value.toUpperCase());
}

function adjacentCharacter(text: string, position: number, before: boolean): string {
  // Compare encoded neighbours without changing the returned data or decoding its tree.
  for (const size of [3, 6, 9, 12]) {
    const part = before ? text.slice(Math.max(0, position - size), position) : text.slice(position, position + size);
    if (part.length !== size || !/^(?:%[\da-f]{2})+$/i.test(part)) continue;
    try { const decoded = decodeURIComponent(part); if (Array.from(decoded).length === 1) return decoded; } catch { /* Check the complete UTF-8 sequence next. */ }
  }
  for (const size of [2, 6, 12]) {
    const part = before ? text.slice(Math.max(0, position - size), position) : text.slice(position, position + size);
    if (part.length !== size || !part.startsWith("\\")) continue;
    try { const decoded: unknown = JSON.parse(`"${part}"`); if (typeof decoded === "string" && Array.from(decoded).length === 1) return decoded; } catch { /* The neighbour is ordinary text. */ }
  }
  let index = before ? position - 1 : position;
  if (index < 0 || index >= text.length) return "";
  if (before && index > 0 && /[\uDC00-\uDFFF]/.test(text[index]) && /[\uD800-\uDBFF]/.test(text[index - 1])) index--;
  return String.fromCodePoint(text.codePointAt(index)!);
}

function insidePlaceholder(text: string, index: number, length: number): boolean {
  for (const marker of [REDACTED_API_KEY, REDACTED_TOKEN]) {
    const start = Math.max(0, index - marker.length + 1);
    const position = text.slice(start, index + marker.length).lastIndexOf(marker, index - start);
    if (position >= 0 && start + position + marker.length >= index + length) return true;
  }
  return false;
}

function redactJsonEscapes(text: string, secrets: Secrets): string {
  const secret = secrets.value;
  if (!secret || !text.includes("\\")) return text;
  // Match decoded code units in one pass without a response-sized offset table or regex.
  let prefix = secrets.jsonPrefix;
  if (!prefix) {
    prefix = secrets.jsonPrefix = new Uint32Array(secret.length);
    for (let i = 1, length = 0; i < secret.length; i++) {
      while (length > 0 && secret[i] !== secret[length]) length = prefix[length - 1];
      if (secret[i] === secret[length]) length++;
      prefix[i] = length;
    }
  }
  const starts = new Uint32Array(secret.length);
  let matched = 0, units = 0, from = 0, result = "";
  for (let i = 0; i < text.length;) {
    const start = i;
    let code = text.charCodeAt(i++);
    if (code === 92) {
      if (text[i] === "u" && /^[\da-f]{4}$/i.test(text.slice(i + 1, i + 5))) {
        code = Number.parseInt(text.slice(i + 1, i + 5), 16);
        i += 5;
      } else if (Object.hasOwn(JSON_ESCAPE_CODE, text[i])) code = JSON_ESCAPE_CODE[text[i++]];
    }
    starts[units++ % secret.length] = start;
    while (matched > 0 && code !== secret.charCodeAt(matched)) matched = prefix[matched - 1];
    if (code === secret.charCodeAt(matched)) matched++;
    if (matched !== secret.length) continue;
    const position = starts[(units - secret.length) % secret.length];
    const boundary = !secrets.short || (!WORD_CHARACTER.test(adjacentCharacter(text, position, true)) && !WORD_CHARACTER.test(adjacentCharacter(text, i, false)));
    if (!insidePlaceholder(text, position, i - position) && boundary) {
      result += text.slice(from, position) + REDACTED_API_KEY;
      from = i;
      matched = 0;
    } else matched = prefix[matched - 1];
  }
  return from > 0 ? result + text.slice(from) : text;
}

function redactKnown(text: string, secrets: Secrets): string {
  let redacted = redactJsonEscapes(text, secrets), normalized: string | undefined, normalizedEncoding: string | undefined;
  for (const variant of secrets.variants) {
    const { value } = variant;
    const encoding = `${variant.percentDepth}`;
    if (normalized === undefined || encoding !== normalizedEncoding) {
      normalized = normalizeEscapes(redacted, variant);
      normalizedEncoding = encoding;
    }
    const haystack = normalized;
    const needle = normalizeEscapes(value, variant);
    let index = haystack.indexOf(needle), from = 0, result = "";
    while (index !== -1) {
      const boundary = !secrets.short || (!WORD_CHARACTER.test(adjacentCharacter(redacted, index, true)) && !WORD_CHARACTER.test(adjacentCharacter(redacted, index + value.length, false)));
      const replace = !insidePlaceholder(redacted, index, value.length) && boundary;
      if (replace) {
        result += redacted.slice(from, index) + REDACTED_API_KEY;
        from = index + value.length;
      }
      index = haystack.indexOf(needle, index + (replace ? value.length : 1));
    }
    if (from > 0) { redacted = result + redacted.slice(from); normalized = undefined; }
  }
  return redacted;
}

export function redactKnownSecrets(text: string): string {
  return redactKnown(text, configuredSecrets());
}

function redactDiagnostic(text: string, secrets: Secrets): string {
  return redactKnown(text, secrets)
    .replace(/((?:"x-ipgeolocation-api-key"|x-ipgeolocation-api-key)\s*[:=]\s*["']?)([^"',\s}]+)(["']?)/gi, `$1${REDACTED_API_KEY}$3`)
    .replace(/([?&](?:apiKey|apikey|api_key|api-key)=)[^&#\s"']+/gi, `$1${REDACTED_API_KEY}`)
    .replace(/((?:apiKey|apikey|api_key|api-key)%3D)[^&#\s"']+/gi, `$1${REDACTED_API_KEY}`)
    .replace(/((?:"(?:apiKey|apikey|api_key|api-key)"|(?:apiKey|apikey|api_key|api-key))\s*[:=]\s*["']?)([^"',\s}]+)(["']?)/gi, `$1${REDACTED_API_KEY}$3`)
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,"']+/gi, `$1${REDACTED_TOKEN}`)
    .replace(/\bbearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED_TOKEN}`);
}

export function redactSensitiveText(text: string): string {
  return redactDiagnostic(text, configuredSecrets());
}

export function redactSensitiveValue(value: unknown, bulkItemMessages = false): unknown {
  // Success strings are data; diagnostic patterns apply only to bulk item errors.
  const secrets = configuredSecrets();
  function redact(value: unknown, diagnosticMessage = false): unknown {
    if (typeof value === "string") return redactKnown(value, secrets);
    if (typeof value === "number" && Number.isFinite(value) && !secrets.short && String(value) === secrets.value) return REDACTED_API_KEY;
    if (Array.isArray(value)) return value.map(child => redact(child, diagnosticMessage));
    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [
        redactKnown(key, secrets),
        /^(?:api[-_]?key|x-ipgeolocation-api-key)$/i.test(key) ? REDACTED_API_KEY
          : /^authorization$/i.test(key) ? REDACTED_TOKEN
          : diagnosticMessage && key === "message" && typeof child === "string" ? redactDiagnostic(child, secrets)
          : redact(child),
      ]));
    }
    return value;
  }
  return redact(value, bulkItemMessages);
}
