import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportEnv } from "../src/direnv";
import { mockCommand, SpawnSpyManager } from "./helpers";

describe("exportEnv", () => {
  let tempDir: string;
  let envrcPath: string;
  const spyManager = new SpawnSpyManager();
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "direnv-test-"));
    envrcPath = join(tempDir, ".envrc");
    writeFileSync(envrcPath, "export TEST_VAR=test_value");
  });

  afterEach(() => {
    rmSync(tempDir, { force: true, recursive: true });

    spyManager.restoreAll();
  });

  function mockDirenv(
    handler: (cwd: string) => { stderr?: string; stdout?: string; success: boolean }
  ) {
    return mockCommand("direnv", handler, spyManager);
  }

  it("should parse valid direnv export json output", async () => {
    mockDirenv(() => ({
      stdout: JSON.stringify({
        ANOTHER_VAR: "another_value",
        TEST_VAR: "test_value",
      }),
      success: true,
    }));

    const result = await exportEnv(envrcPath);

    expect(result).toEqual({
      env: {
        ANOTHER_VAR: "another_value",
        TEST_VAR: "test_value",
      },
      ok: true,
    });
  });

  it("should handle null values as unset semantics", async () => {
    mockDirenv(() => ({
      stdout: JSON.stringify({
        NULL_VAR: null,
        TEST_VAR: "test_value",
      }),
      success: true,
    }));

    const result = await exportEnv(envrcPath);

    expect(result).toEqual({
      env: {
        TEST_VAR: "test_value",
      },
      ok: true,
    });
  });

  it("should ignore non-string values while keeping exported strings", async () => {
    mockDirenv(() => ({
      stdout: JSON.stringify({
        COUNT: 1,
        ENABLED: true,
        NESTED: { nope: true },
        NULL_VAR: null,
        TEST_VAR: "test_value",
        VALUES: ["a", "b"],
      }),
      success: true,
    }));

    const result = await exportEnv(envrcPath);

    expect(result).toEqual({
      env: {
        TEST_VAR: "test_value",
      },
      ok: true,
    });
  });

  it("should return empty env on parse failure", async () => {
    mockDirenv(() => ({
      stdout: "direnv warning\nnot-json",
      success: true,
    }));

    const result = await exportEnv(envrcPath);

    expect(result).toEqual({ ok: false, reason: "direnv output is not valid JSON" });
  });

  it("should return empty env when direnv command fails", async () => {
    mockDirenv(() => ({
      stderr: "direnv: command not found",
      success: false,
    }));

    const result = await exportEnv(envrcPath);

    expect(result).toEqual({ ok: false, reason: "direnv command failed" });
  });

  it("should handle corrupted/malformed JSON output safely", async () => {
    mockDirenv(() => ({
      stdout: "totally-garbage-output",
      success: true,
    }));

    const result = await exportEnv(envrcPath);

    expect(result).toEqual({ ok: false, reason: "direnv output is not valid JSON" });
  });

  it("should parse JSON after warning lines before payload", async () => {
    mockDirenv(() => ({
      stdout: 'direnv: loading /tmp/demo\n{"TEST_VAR":"test_value"}',
      success: true,
    }));

    const result = await exportEnv(envrcPath);

    expect(result).toEqual({
      env: {
        TEST_VAR: "test_value",
      },
      ok: true,
    });
  });

  it("should merge env vars from direnv output", async () => {
    mockDirenv(() => ({
      stdout: JSON.stringify({
        BAR: "baz",
        FOO: "bar",
      }),
      success: true,
    }));

    const result = await exportEnv(envrcPath);

    expect(result.ok).toBeTrue();
    if (!result.ok) {
      throw new Error("expected successful export");
    }

    for (const [key, value] of Object.entries(result.env)) {
      expect(typeof key).toBe("string");
      expect(typeof value).toBe("string");
    }
  });

  it("should handle empty direnv output gracefully", async () => {
    mockDirenv(() => ({
      stdout: "",
      success: true,
    }));

    const result = await exportEnv(envrcPath);

    expect(result).toEqual({ env: {}, ok: true });
  });

  it("should handle special characters in env var values", async () => {
    mockDirenv(() => ({
      stdout: JSON.stringify({
        QUOTED: 'value with spaces and "quotes"',
      }),
      success: true,
    }));

    const result = await exportEnv(envrcPath);

    expect(result).toEqual({
      env: {
        QUOTED: 'value with spaces and "quotes"',
      },
      ok: true,
    });
  });

  it("should not leak direnv internal variables", async () => {
    mockDirenv(() => ({
      stdout: JSON.stringify({
        DIRENV_DIFF: "abc",
        DIRENV_DIR: "/internal",
        TEST_VAR: "test_value",
      }),
      success: true,
    }));

    const result = await exportEnv(envrcPath);

    expect(result.ok).toBeTrue();
    if (!result.ok) {
      throw new Error("expected ok");
    }

    expect(result.env).toEqual({ TEST_VAR: "test_value" });
  });

  it("should not leak nix build-system internals from direnv output", async () => {
    mockDirenv(() => ({
      stdout: JSON.stringify({
        __structuredAttrs: "",
        builder: "/nix/store/bash",
        buildInputs: "",
        buildPhase: "...",
        configurePhase: "...",
        DETERMINISTIC_BUILD: "1",
        dontAddDisableDepTrack: "1",
        installPhase: "...",
        name: "dev-shell",
        nativeBuildInputs: "/nix/store/...",
        NIX_BUILD_CORES: "8",
        out: "/nix/store/out",
        PATH: "/nix/store/...",
        phases: "nobuildPhase",
        shell: "/nix/store/bash",
        SOURCE_DATE_EPOCH: "315532800",
        stdenv: "/nix/store/stdenv",
        strictDeps: "",
        system: "x86_64-linux",
        TEST_VAR: "keep",
      }),
      success: true,
    }));

    const result = await exportEnv(envrcPath);

    expect(result.ok).toBeTrue();
    if (!result.ok) {
      throw new Error("expected ok");
    }

    expect(result.env).toEqual({
      PATH: "/nix/store/...",
      TEST_VAR: "keep",
    });
  });
});
