import { getConfiguredApiKey } from "./config.js";

const REDACTED_API_KEY = "[REDACTED_API_KEY]";
const REDACTED_TOKEN = "[REDACTED_TOKEN]";

function uniqueSecretVariants(secret: string): string[] {
  const variants = new Set<string>();
  const trimmed = secret.trim();

  if (!trimmed) {
    return [];
  }

  variants.add(trimmed);
  variants.add(encodeURIComponent(trimmed));
  variants.add(encodeURIComponent(encodeURIComponent(trimmed)));

  return [...variants].sort((a, b) => b.length - a.length);
}

export function redactSensitiveText(text: string): string {
  let redacted = text;

  const configuredApiKey = getConfiguredApiKey();
  if (configuredApiKey) {
    for (const variant of uniqueSecretVariants(configuredApiKey)) {
      redacted = redacted.replaceAll(variant, REDACTED_API_KEY);
    }
  }

  redacted = redacted
    .replace(
      /((?:"x-ipgeolocation-api-key"|x-ipgeolocation-api-key)\s*[:=]\s*["']?)([^"',\s}]+)(["']?)/gi,
      `$1${REDACTED_API_KEY}$3`
    )
    .replace(
      /([?&](?:apiKey|apikey|api_key|api-key)=)[^&#\s"']+/gi,
      `$1${REDACTED_API_KEY}`
    )
    .replace(
      /((?:apiKey|apikey|api_key|api-key)%3D)(?:%[0-9A-Fa-f]{2}|[^&#\s"'])+/gi,
      `$1${REDACTED_API_KEY}`
    )
    .replace(
      /((?:"(?:apiKey|apikey|api_key|api-key)"|(?:apiKey|apikey|api_key|api-key))\s*[:=]\s*["']?)([^"',\s}]+)(["']?)/gi,
      `$1${REDACTED_API_KEY}$3`
    )
    .replace(
      /(authorization\s*[:=]\s*bearer\s+)[^\s,"']+/gi,
      `$1${REDACTED_TOKEN}`
    )
    .replace(/\bbearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED_TOKEN}`);

  return redacted;
}
