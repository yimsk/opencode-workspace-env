import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin";
import { EnvCache } from "./cache.js";
import { exportEnv } from "./direnv.js";
import { exportNixEnv } from "./nix.js";
import { resolveEnvSource } from "./resolve.js";
import type { EnvExportResult } from "./types.js";

export const name = "opencode-workspace-env";
export const version = "0.1.2";
export const description = "OpenCode plugin for per-workspace env injection via shell.env hook";

const cache = new EnvCache();

const plugin: Plugin = async (_input: PluginInput): Promise<Hooks> => {
  return {
    "shell.env": async (hookInput, output) => {
      output.env = await loadWorkspaceEnv(hookInput.cwd);
    },
  };
};

async function loadWorkspaceEnv(cwd: string): Promise<Record<string, string>> {
  try {
    const resolved = await resolveEnvSource(cwd);
    if (!resolved) {
      return emptyEnv();
    }

    if (resolved.type === "envrc") {
      return await readCachedEnv(resolved.envrcPath, () => exportEnv(resolved.envrcPath));
    }

    return await readCachedEnv(resolved.flakeNixPath, () => exportNixEnv(resolved.flakeNixPath));
  } catch {
    /* fail-silent per design, reason lost intentionally at top level */
    return emptyEnv();
  }
}

async function readCachedEnv(
  sourcePath: string,
  exporter: () => Promise<EnvExportResult>
): Promise<Record<string, string>> {
  const fingerprint = await cache.computeFingerprint(sourcePath);
  const cached = cache.get(sourcePath, fingerprint);

  if (cached) {
    return cached;
  }

  const exported = await exporter();
  if (!exported.ok) {
    return emptyEnv();
  }

  cache.set(sourcePath, fingerprint, exported.env);
  return exported.env;
}

function emptyEnv(): Record<string, string> {
  return {};
}

export default plugin;
