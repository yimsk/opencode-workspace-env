/**
 * Shared types and JSON utilities for environment export operations.
 */

/**
 * Result type for environment export operations.
 * Discriminated union: ok=true returns env, ok=false indicates failure.
 */
export type EnvExportResult =
  | { env: Record<string, string>; ok: true }
  | { ok: false; reason?: string };

/**
 * Type guard to check if a value is a plain object (not null, not array).
 * Replaces the repeated check: `typeof x !== 'object' || x === null || Array.isArray(x)`
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Safely parse a JSON string that may have non-JSON prefix content.
 * Extracts JSON starting from the first '{' character, parses it, and
 * validates the result is a plain object.
 *
 * @param raw - String that may contain JSON with optional prefix
 * @returns Parsed object or undefined if parsing fails or result isn't an object
 */
export function safeParseJson(raw: string): Record<string, unknown> | undefined {
  const jsonStart = raw.indexOf("{");
  if (jsonStart === -1) {
    return undefined;
  }

  const jsonPayload = raw.slice(jsonStart);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonPayload);
  } catch {
    return undefined;
  }

  if (!isPlainObject(parsed)) {
    return undefined;
  }

  return parsed;
}
