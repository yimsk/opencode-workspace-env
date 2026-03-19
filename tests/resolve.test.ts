import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveEnvSource } from "../src/resolve";

describe("resolveEnvSource", () => {
  let tempDir: string;
  let gitRoot: string;
  let nestedDir: string;
  let noEnvrcDir: string;
  let aboveGitRootDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "resolve-test-"));
    gitRoot = join(tempDir, "project");
    nestedDir = join(gitRoot, "src", "components");
    noEnvrcDir = join(tempDir, "no-project");
    aboveGitRootDir = tempDir;

    mkdirSync(nestedDir, { recursive: true });
    mkdirSync(noEnvrcDir, { recursive: true });

    Bun.spawnSync(["git", "init"], { cwd: gitRoot });
  });

  afterEach(() => {
    rmSync(tempDir, { force: true, recursive: true });
  });

  describe(".envrc resolution", () => {
    beforeEach(() => {
      writeFileSync(join(gitRoot, ".envrc"), "export FOO=bar");
    });

    it("should find nearest .envrc for nested cwd", async () => {
      const result = await resolveEnvSource(nestedDir);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("envrc");
      if (result?.type === "envrc") {
        expect(result.envrcPath).toBe(join(gitRoot, ".envrc"));
        expect(result.gitRoot).toBe(gitRoot);
      }
    });

    it("should return envrc type when cwd is git root", async () => {
      const result = await resolveEnvSource(gitRoot);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("envrc");
      if (result?.type === "envrc") {
        expect(result.envrcPath).toBe(join(gitRoot, ".envrc"));
        expect(result.gitRoot).toBe(gitRoot);
      }
    });

    it("should stop at git root and not traverse above", async () => {
      writeFileSync(join(aboveGitRootDir, ".envrc"), "export SHOULD_NOT_SEE=this");

      const result = await resolveEnvSource(nestedDir);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("envrc");
      if (result?.type === "envrc") {
        expect(result.envrcPath).toBe(join(gitRoot, ".envrc"));
        expect(result.envrcPath).not.toBe(join(aboveGitRootDir, ".envrc"));
      }
    });

    it("should find .envrc in parent directory within git repo", async () => {
      const parentDir = join(gitRoot, "src");
      const deepDir = join(parentDir, "deep", "nested", "path");
      mkdirSync(deepDir, { recursive: true });

      writeFileSync(join(parentDir, ".envrc"), "export FROM_SRC=true");
      rmSync(join(gitRoot, ".envrc"));

      const result = await resolveEnvSource(deepDir);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("envrc");
      if (result?.type === "envrc") {
        expect(result.envrcPath).toBe(join(parentDir, ".envrc"));
        expect(result.gitRoot).toBe(gitRoot);
      }
    });

    it("should prefer closest .envrc when multiple exist in hierarchy", async () => {
      const parentDir = join(gitRoot, "src");
      mkdirSync(parentDir, { recursive: true });

      writeFileSync(join(parentDir, ".envrc"), "export CLOSER=true");

      const result = await resolveEnvSource(parentDir);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("envrc");
      if (result?.type === "envrc") {
        expect(result.envrcPath).toBe(join(parentDir, ".envrc"));
      }
    });

    it("should handle relative paths by resolving to absolute", async () => {
      const relativePath = "./src/components";
      const resolvedPath = join(gitRoot, relativePath);

      const result = await resolveEnvSource(resolvedPath);

      expect(result).not.toBeNull();
      if (result?.type === "envrc") {
        expect(result.envrcPath).toStartWith("/");
        expect(result.gitRoot).toStartWith("/");
      }
    });
  });

  describe("flake.nix fallback", () => {
    it("should fallback to flake type when no .envrc but flake.nix exists", async () => {
      writeFileSync(join(gitRoot, "flake.nix"), "{ outputs = { ... }: {}; }");

      const result = await resolveEnvSource(nestedDir);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("flake");
      if (result?.type === "flake") {
        expect(result.flakeNixPath).toBe(join(gitRoot, "flake.nix"));
        expect(result.gitRoot).toBe(gitRoot);
      }
    });

    it("should find flake.nix from nested directory", async () => {
      writeFileSync(join(gitRoot, "flake.nix"), "{ outputs = { ... }: {}; }");

      const deepDir = join(gitRoot, "src", "deep", "nested");
      mkdirSync(deepDir, { recursive: true });

      const result = await resolveEnvSource(deepDir);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("flake");
      if (result?.type === "flake") {
        expect(result.flakeNixPath).toBe(join(gitRoot, "flake.nix"));
      }
    });

    it("should not find flake.nix above git root", async () => {
      writeFileSync(join(tempDir, "flake.nix"), "{ outputs = { ... }: {}; }");

      const result = await resolveEnvSource(nestedDir);

      expect(result).toBeNull();
    });
  });

  describe("priority and edge cases", () => {
    it("should prefer .envrc over flake.nix when both exist", async () => {
      writeFileSync(join(gitRoot, ".envrc"), "use flake");
      writeFileSync(join(gitRoot, "flake.nix"), "{ outputs = { ... }: {}; }");

      const result = await resolveEnvSource(nestedDir);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("envrc");
    });

    it("should find closest .envrc even when flake.nix is at root", async () => {
      const srcDir = join(gitRoot, "src");
      writeFileSync(join(srcDir, ".envrc"), "export LOCAL=true");
      writeFileSync(join(gitRoot, "flake.nix"), "{ outputs = { ... }: {}; }");

      const result = await resolveEnvSource(join(srcDir, "components"));

      expect(result).not.toBeNull();
      expect(result?.type).toBe("envrc");
      if (result?.type === "envrc") {
        expect(result.envrcPath).toBe(join(srcDir, ".envrc"));
      }
    });

    it("should return null when neither .envrc nor flake.nix exists", async () => {
      const result = await resolveEnvSource(nestedDir);

      expect(result).toBeNull();
    });

    it("should return null when cwd is not in a git repo", async () => {
      const result = await resolveEnvSource(noEnvrcDir);

      expect(result).toBeNull();
    });

    it("should ignore .envrc above git root when repo has none", async () => {
      writeFileSync(join(aboveGitRootDir, ".envrc"), "export SHOULD_NOT_SEE=this");

      const result = await resolveEnvSource(nestedDir);

      expect(result).toBeNull();
    });
  });
});
