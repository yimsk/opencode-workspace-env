import { dirname, join } from "node:path";

// Module-level shared storage (singleton pattern - shared across all EnvCache instances)
const sharedStorage = new Map<string, Record<string, string>>();
// Track latest fingerprint per sourcePath for eviction
const latestFingerprints = new Map<string, string>();
const MAX_ENTRIES = 50;

function buildCacheKey(sourcePath: string, fingerprint: string): string {
  return `${sourcePath}::${fingerprint}`;
}

function cloneEnv(env: Record<string, string>): Record<string, string> {
  return { ...env };
}

async function readTextIfPresent(filePath: string): Promise<string> {
  try {
    return await Bun.file(filePath).text();
  } catch {
    return "";
  }
}

async function sha256Hex(content: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export class EnvCache {
  private storage = sharedStorage;

  get(sourcePath: string, fingerprint: string): Record<string, string> | undefined {
    const cachedEnv = this.storage.get(buildCacheKey(sourcePath, fingerprint));
    return cachedEnv ? cloneEnv(cachedEnv) : undefined;
  }

  set(sourcePath: string, fingerprint: string, env: Record<string, string>): void {
    // Evict old fingerprint entry if it exists and differs from new one
    const previousFingerprint = latestFingerprints.get(sourcePath);
    if (previousFingerprint && previousFingerprint !== fingerprint) {
      this.storage.delete(buildCacheKey(sourcePath, previousFingerprint));
    }
    // Update tracking and store new entry
    latestFingerprints.set(sourcePath, fingerprint);
    this.storage.set(buildCacheKey(sourcePath, fingerprint), cloneEnv(env));

    if (latestFingerprints.size > MAX_ENTRIES) {
      const oldestSourcePath = latestFingerprints.keys().next().value!;
      const oldestFingerprint = latestFingerprints.get(oldestSourcePath)!;
      this.storage.delete(buildCacheKey(oldestSourcePath, oldestFingerprint));
      latestFingerprints.delete(oldestSourcePath);
    }
  }

  async computeFingerprint(sourcePath: string): Promise<string> {
    const flakeLockPath = join(dirname(sourcePath), "flake.lock");

    const content =
      (await readTextIfPresent(sourcePath)) + (await readTextIfPresent(flakeLockPath));

    return sha256Hex(content);
  }
}
