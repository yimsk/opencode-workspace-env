import { dirname } from "node:path";
import { isExcludedEnvKey } from "./filter.js";
import { type EnvExportResult, safeParseJson } from "./types.js";

function collectExportedEnv(parsed: Record<string, unknown>): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(parsed)) {
    if (value === null) {
      continue;
    }
    if (typeof value !== "string") {
      continue;
    }
    if (isExcludedEnvKey(key)) {
      continue;
    }
    env[key] = value;
  }

  return env;
}

export async function exportEnv(envrcPath: string): Promise<EnvExportResult> {
  try {
    const cwd = dirname(envrcPath);

    const result = Bun.spawnSync(["direnv", "export", "json"], { cwd });

    if (!result.success) {
      return { ok: false, reason: "direnv command failed" };
    }

    const raw = result.stdout.toString().trim();
    if (!raw) {
      return { env: {}, ok: true };
    }

    const parsed = safeParseJson(raw);
    if (!parsed) {
      return { ok: false, reason: "direnv output is not valid JSON" };
    }

    return { env: collectExportedEnv(parsed), ok: true };
  } catch (error) {
    return { ok: false, reason: `direnv export failed: ${String(error)}` };
  }
}
