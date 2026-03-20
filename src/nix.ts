import { dirname } from "node:path";
import { isExcludedEnvKey } from "./filter.js";
import { type EnvExportResult, safeParseJson } from "./types.js";

interface NixVariable {
  type: string;
  value: unknown;
}

interface NixPrintDevEnvOutput {
  variables?: Record<string, NixVariable>;
}

function isNixPrintDevEnvOutput(v: unknown): v is NixPrintDevEnvOutput {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    return false;
  }

  if (!("variables" in v)) {
    return true;
  }

  const { variables } = v;
  return (
    variables === undefined ||
    (typeof variables === "object" && variables !== null && !Array.isArray(variables))
  );
}

function parseNixOutput(raw: string): NixPrintDevEnvOutput | undefined {
  const parsed = safeParseJson(raw);
  if (!parsed || !isNixPrintDevEnvOutput(parsed)) {
    return undefined;
  }

  return parsed;
}

function mergePath(nixPath: string): string {
  const current = process.env.PATH ?? "";
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const p of nixPath.split(":")) {
    if (p && !seen.has(p)) {
      seen.add(p);
      merged.push(p);
    }
  }
  for (const p of current.split(":")) {
    if (p && !seen.has(p)) {
      seen.add(p);
      merged.push(p);
    }
  }

  return merged.join(":");
}

function collectNixEnv(output: NixPrintDevEnvOutput): Record<string, string> {
  const env: Record<string, string> = {};
  const variables = output.variables;

  if (!variables || typeof variables !== "object") {
    return env;
  }

  for (const [key, variable] of Object.entries(variables)) {
    if (isExcludedEnvKey(key)) {
      continue;
    }
    if (variable.type !== "exported") {
      continue;
    }
    if (typeof variable.value !== "string") {
      continue;
    }
    env[key] = key === "PATH" ? mergePath(variable.value) : variable.value;
  }

  return env;
}

export async function exportNixEnv(flakeNixPath: string): Promise<EnvExportResult> {
  try {
    const cwd = dirname(flakeNixPath);

    const result = Bun.spawnSync(["nix", "print-dev-env", "--json"], { cwd });

    if (!result.success) {
      return { ok: false, reason: "nix command failed" };
    }

    const raw = result.stdout.toString().trim();
    if (!raw) {
      return { env: {}, ok: true };
    }

    const parsed = parseNixOutput(raw);
    if (!parsed) {
      return { ok: false, reason: "nix output is not valid JSON" };
    }

    return { env: collectNixEnv(parsed), ok: true };
  } catch (error) {
    return { ok: false, reason: `nix print-dev-env failed: ${String(error)}` };
  }
}
