import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EnvCache } from "../src/cache";

describe("EnvCache", () => {
  let cache: EnvCache;
  let tempDir: string;
  let envrcPath: string;
  let flakeLockPath: string;

  beforeEach(() => {
    cache = new EnvCache();
    tempDir = mkdtempSync(join(tmpdir(), "cache-test-"));
    envrcPath = join(tempDir, ".envrc");
    flakeLockPath = join(tempDir, "flake.lock");

    writeFileSync(envrcPath, "export FOO=bar");
    writeFileSync(flakeLockPath, '{"version": 1}');
  });

  afterEach(() => {
    rmSync(tempDir, { force: true, recursive: true });
  });

  describe("computeFingerprint", () => {
    it("should compute fingerprint from .envrc content", async () => {
      const fingerprint = await cache.computeFingerprint(envrcPath);

      expect(fingerprint).toBeDefined();
      expect(typeof fingerprint).toBe("string");
      expect(fingerprint.length).toBeGreaterThan(0);
    });

    it("should include flake.lock content in fingerprint when exists", async () => {
      const fingerprint1 = await cache.computeFingerprint(envrcPath);

      // Modify flake.lock
      writeFileSync(flakeLockPath, '{"version": 2}');

      const fingerprint2 = await cache.computeFingerprint(envrcPath);

      expect(fingerprint1).not.toBe(fingerprint2);
    });

    it("should compute same fingerprint for same content", async () => {
      const fp1 = await cache.computeFingerprint(envrcPath);
      const fp2 = await cache.computeFingerprint(envrcPath);

      expect(fp1).toBe(fp2);
    });

    it("should compute different fingerprint when .envrc changes", async () => {
      const fp1 = await cache.computeFingerprint(envrcPath);

      writeFileSync(envrcPath, "export FOO=changed");

      const fp2 = await cache.computeFingerprint(envrcPath);

      expect(fp1).not.toBe(fp2);
    });

    it("should handle missing flake.lock gracefully", async () => {
      rmSync(flakeLockPath);

      const fingerprint = await cache.computeFingerprint(envrcPath);

      expect(fingerprint).toBeDefined();
      expect(typeof fingerprint).toBe("string");
    });
  });

  describe("get and set", () => {
    it("should return undefined for cache miss", () => {
      const result = cache.get(envrcPath, "fingerprint123");

      expect(result).toBeUndefined();
    });

    it("should return cached env on cache hit", () => {
      const testEnv = { BAZ: "qux", FOO: "bar" };
      const fingerprint = "fp-abc123";

      cache.set(envrcPath, fingerprint, testEnv);
      const result = cache.get(envrcPath, fingerprint);

      expect(result).toEqual(testEnv);
    });

    it("should not let caller mutation rewrite cached env", () => {
      const fingerprint = "fp-stable";
      const sourceEnv = { FOO: "bar" };

      cache.set(envrcPath, fingerprint, sourceEnv);
      sourceEnv.FOO = "mutated";

      expect(cache.get(envrcPath, fingerprint)).toEqual({ FOO: "bar" });
    });

    it("should return undefined when fingerprint changes (invalidation)", () => {
      const testEnv = { FOO: "bar" };
      const oldFingerprint = "fp-old";
      const newFingerprint = "fp-new";

      cache.set(envrcPath, oldFingerprint, testEnv);
      const result = cache.get(envrcPath, newFingerprint);

      expect(result).toBeUndefined();
    });

    it("should store env under key + fingerprint combination", () => {
      const env1 = { VAR: "value1" };
      const env2 = { VAR: "value2" };

      cache.set(envrcPath, "fp1", env1);
      // fp1 is retrievable before eviction
      expect(cache.get(envrcPath, "fp1")).toEqual(env1);

      // Setting fp2 evicts fp1
      cache.set(envrcPath, "fp2", env2);
      expect(cache.get(envrcPath, "fp1")).toBeUndefined();
      expect(cache.get(envrcPath, "fp2")).toEqual(env2);
    });

    it("should keep cache hits isolated by .envrc path even with same fingerprint", () => {
      const otherEnvrcPath = join(tempDir, "nested workspace", ".envrc");
      const rootEnv = { WORKSPACE: "root" };
      const nestedEnv = { WORKSPACE: "nested" };

      mkdirSync(join(tempDir, "nested workspace"), { recursive: true });
      cache.set(envrcPath, "shared-fp", rootEnv);
      cache.set(otherEnvrcPath, "shared-fp", nestedEnv);

      expect(cache.get(envrcPath, "shared-fp")).toEqual(rootEnv);
      expect(cache.get(otherEnvrcPath, "shared-fp")).toEqual(nestedEnv);
    });

    it("should share cache across multiple hook calls", () => {
      const cache1 = new EnvCache();
      const cache2 = new EnvCache();

      // Expect shared underlying storage
      // (Implementation detail - may vary)
      const testEnv = { SHARED: "true" };
      cache1.set(envrcPath, "shared-fp", testEnv);

      // If using singleton/shared cache
      expect(cache2.get(envrcPath, "shared-fp")).toEqual(testEnv);
    });
  });

  describe("cache invalidation", () => {
    it("should invalidate when .envrc content changes", () => {
      const testEnv = { STABLE: "value" };
      const fp1 = "fp-before-change";

      cache.set(envrcPath, fp1, testEnv);

      // Simulate .envrc change by using different fingerprint
      const fp2 = "fp-after-change";
      const result = cache.get(envrcPath, fp2);

      expect(result).toBeUndefined();
    });

    it("should invalidate when flake.lock changes", () => {
      const testEnv = { NIX_VAR: "value" };
      const fp1 = "fp-before-flake-change";
      const fp2 = "fp-after-flake-change";

      cache.set(envrcPath, fp1, testEnv);
      const result = cache.get(envrcPath, fp2);

      expect(result).toBeUndefined();
    });

    it("should evict old cache entry when new fingerprint is used", () => {
      const testEnv = { PERSISTENT: "data" };
      const fp1 = "fp-v1";

      cache.set(envrcPath, fp1, testEnv);

      // New entry with different fingerprint evicts old entry
      cache.set(envrcPath, "fp-v2", { NEW: "data" });

      // Old entry should be evicted (undefined)
      expect(cache.get(envrcPath, fp1)).toBeUndefined();
    });
    it("should evict multiple old entries, keeping only latest fingerprint", () => {
      // Set 3 different fingerprints for same path
      cache.set(envrcPath, "fp-v1", { V: "1" });
      cache.set(envrcPath, "fp-v2", { V: "2" });
      cache.set(envrcPath, "fp-v3", { V: "3" });

      // Only the latest fingerprint should be retrievable
      expect(cache.get(envrcPath, "fp-v1")).toBeUndefined();
      expect(cache.get(envrcPath, "fp-v2")).toBeUndefined();
      expect(cache.get(envrcPath, "fp-v3")).toEqual({ V: "3" });
    });
  });

  describe("edge cases", () => {
    it("should handle empty env object", () => {
      cache.set(envrcPath, "empty-fp", {});
      const result = cache.get(envrcPath, "empty-fp");

      expect(result).toEqual({});
    });

    it("should handle env with many variables", () => {
      const largeEnv: Record<string, string> = {};
      for (let i = 0; i < 100; i++) {
        largeEnv[`VAR_${i}`] = `value_${i}`;
      }

      cache.set(envrcPath, "large-fp", largeEnv);
      const result = cache.get(envrcPath, "large-fp");

      expect(result).toEqual(largeEnv);
    });

    it("should handle special characters in paths", () => {
      const specialPath = "/path/with spaces/and-dashes/.envrc";
      const testEnv = { SPECIAL: "true" };

      cache.set(specialPath, "fp-special", testEnv);
      const result = cache.get(specialPath, "fp-special");

      expect(result).toEqual(testEnv);
    });

    it("should NOT use TTL expiration (explicit requirement)", () => {
      // Cache should not expire based on time
      // This is a design requirement - no TTL
      const testEnv = { NO_TTL: "true" };

      cache.set(envrcPath, "no-ttl-fp", testEnv);

      // Even after theoretical time passage, should still be valid
      // (We can't actually test time without timeouts, but test the API)
      expect(cache.get(envrcPath, "no-ttl-fp")).toEqual(testEnv);
    });
  });

  describe("max entries eviction", () => {
    const MAX_ENTRIES = 50;

    it("should evict the oldest sourcePath when entry count exceeds max", () => {
      const sourcePaths = Array.from(
        { length: MAX_ENTRIES + 1 },
        (_, index) => `/workspace/proj-${index}/flake.nix`
      );

      for (const [index, sourcePath] of sourcePaths.entries()) {
        cache.set(sourcePath, `fp-${index}`, { INDEX: String(index) });
      }

      expect(cache.get(sourcePaths[0], "fp-0")).toBeUndefined();
      expect(cache.get(sourcePaths[MAX_ENTRIES], `fp-${MAX_ENTRIES}`)).toEqual({
        INDEX: String(MAX_ENTRIES),
      });
    });

    it("should keep all new entries when entry count reaches but does not exceed max", () => {
      const sourcePaths = Array.from(
        { length: MAX_ENTRIES },
        (_, index) => `/workspace/at-limit-${index}/flake.nix`
      );

      for (const [index, sourcePath] of sourcePaths.entries()) {
        cache.set(sourcePath, `limit-fp-${index}`, { INDEX: String(index) });
      }

      for (const [index, sourcePath] of sourcePaths.entries()) {
        expect(cache.get(sourcePath, `limit-fp-${index}`)).toEqual({ INDEX: String(index) });
      }
    });

    it("should keep per-sourcePath fingerprint eviction working alongside max entry eviction", () => {
      const sourcePath = "/workspace/coexist/flake.nix";

      cache.set(sourcePath, "coexist-fp-v1", { VERSION: "1" });
      cache.set(sourcePath, "coexist-fp-v2", { VERSION: "2" });

      expect(cache.get(sourcePath, "coexist-fp-v1")).toBeUndefined();
      expect(cache.get(sourcePath, "coexist-fp-v2")).toEqual({ VERSION: "2" });
    });
  });
});
