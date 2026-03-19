import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type ResolvedEnvSource =
  | { envrcPath: string; gitRoot: string; type: "envrc" }
  | { flakeNixPath: string; gitRoot: string; type: "flake" };

export async function resolveEnvSource(cwd: string): Promise<ResolvedEnvSource | null> {
  const absoluteCwd = normalizeCwd(cwd);

  const gitRoot = await getGitRoot(absoluteCwd);
  if (!gitRoot) {
    return null;
  }

  const envrcPath = findNearestFile(absoluteCwd, gitRoot, ".envrc");
  if (envrcPath) {
    return { envrcPath, gitRoot, type: "envrc" };
  }

  const flakeNixPath = findNearestFile(absoluteCwd, gitRoot, "flake.nix");
  if (flakeNixPath) {
    return { flakeNixPath, gitRoot, type: "flake" };
  }

  return null;
}

function normalizeCwd(cwd: string): string {
  try {
    return Bun.fileURLToPath(new URL(cwd, `file://${process.cwd()}/`));
  } catch {
    return resolve(cwd);
  }
}

function findNearestFile(startDir: string, gitRoot: string, filename: string): string | null {
  let currentDir = startDir;

  while (true) {
    const filePath = join(currentDir, filename);
    if (existsSync(filePath)) {
      return filePath;
    }

    if (currentDir === gitRoot) {
      return null;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

async function getGitRoot(cwd: string): Promise<string | null> {
  try {
    const result = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
      cwd,
    });

    if (result.success) {
      return result.stdout.toString().trim();
    }

    return null;
  } catch {
    return null;
  }
}
