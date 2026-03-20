import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportNixEnv } from "../src/nix";
import { mockCommand, SpawnSpyManager } from "./helpers";

describe("exportNixEnv", () => {
  let tempDir: string;
  let flakeNixPath: string;
  const spyManager = new SpawnSpyManager();

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "nix-test-"));
    flakeNixPath = join(tempDir, "flake.nix");
    writeFileSync(flakeNixPath, "{ outputs = { ... }: {}; }");
  });

  afterEach(() => {
    rmSync(tempDir, { force: true, recursive: true });

    spyManager.restoreAll();
  });

  function mockNix(
    handler: (cwd: string) => { stderr?: string; stdout?: string; success: boolean }
  ) {
    return mockCommand("nix", handler, spyManager);
  }

  it("should parse valid nix print-dev-env json output", async () => {
    mockNix(() => ({
      stdout: JSON.stringify({
        variables: {
          CUSTOM_VAR: { type: "exported", value: "custom_value" },
          PATH: { type: "exported", value: "/nix/store/...:..." },
        },
      }),
      success: true,
    }));

    const result = await exportNixEnv(flakeNixPath);

    expect(result).toEqual({
      env: {
        CUSTOM_VAR: "custom_value",
        PATH: "/nix/store/...:...",
      },
      ok: true,
    });
  });

  it("should filter out nix build-system internal variables", async () => {
    mockNix(() => ({
      stdout: JSON.stringify({
        variables: {
          builder: { type: "exported", value: "/nix/store/..." },
          buildInputs: { type: "exported", value: "" },
          buildPhase: { type: "exported", value: "..." },
          configurePhase: { type: "exported", value: "..." },
          CUSTOM_VAR: { type: "exported", value: "keep" },
          dontAddDisableDepTrack: { type: "exported", value: "1" },
          installPhase: { type: "exported", value: "..." },
          name: { type: "exported", value: "dev-shell" },
          nativeBuildInputs: { type: "exported", value: "/nix/store/..." },
          out: { type: "exported", value: "/nix/store/..." },
          phases: { type: "exported", value: "nobuildPhase" },
          shell: { type: "exported", value: "/nix/store/.../bash" },
          SOURCE_DATE_EPOCH: { type: "exported", value: "315532800" },
          stdenv: { type: "exported", value: "/nix/store/..." },
          strictDeps: { type: "exported", value: "" },
          system: { type: "exported", value: "x86_64-linux" },
        },
      }),
      success: true,
    }));

    const result = await exportNixEnv(flakeNixPath);

    expect(result.ok).toBeTrue();
    if (!result.ok) {
      throw new Error("expected ok");
    }

    expect(result.env).toEqual({ CUSTOM_VAR: "keep" });
  });

  it("should filter out __-prefixed and NIX_BUILD_-prefixed variables", async () => {
    mockNix(() => ({
      stdout: JSON.stringify({
        variables: {
          __sandboxProfile: { type: "exported", value: "" },
          __structuredAttrs: { type: "exported", value: "" },
          CUSTOM_VAR: { type: "exported", value: "keep" },
          NIX_BUILD_CORES: { type: "exported", value: "8" },
          NIX_BUILD_TOP: { type: "exported", value: "/tmp/nix-build" },
        },
      }),
      success: true,
    }));

    const result = await exportNixEnv(flakeNixPath);

    expect(result.ok).toBeTrue();
    if (!result.ok) {
      throw new Error("expected ok");
    }

    expect(result.env).toEqual({ CUSTOM_VAR: "keep" });
  });

  it("should only include exported type variables", async () => {
    mockNix(() => ({
      stdout: JSON.stringify({
        variables: {
          ARRAY_TYPE: { type: "array", value: ["a", "b"] },
          EXPORTED_VAR: { type: "exported", value: "yes" },
          VAR_TYPE: { type: "var", value: "no" },
        },
      }),
      success: true,
    }));

    const result = await exportNixEnv(flakeNixPath);

    expect(result).toEqual({
      env: { EXPORTED_VAR: "yes" },
      ok: true,
    });
  });

  it("should return ok:false when nix command fails", async () => {
    mockNix(() => ({
      stderr: "error: nix not found",
      success: false,
    }));

    const result = await exportNixEnv(flakeNixPath);

    expect(result).toEqual({ ok: false, reason: "nix command failed" });
  });

  it("should return ok:false when output is malformed", async () => {
    mockNix(() => ({
      stdout: "not-json-at-all",
      success: true,
    }));

    const result = await exportNixEnv(flakeNixPath);

    expect(result).toEqual({ ok: false, reason: "nix output is not valid JSON" });
  });

  it("should return empty env when no variables key", async () => {
    mockNix(() => ({
      stdout: JSON.stringify({}),
      success: true,
    }));

    const result = await exportNixEnv(flakeNixPath);

    expect(result).toEqual({ env: {}, ok: true });
  });

  it("should handle empty stdout gracefully", async () => {
    mockNix(() => ({
      stdout: "",
      success: true,
    }));

    const result = await exportNixEnv(flakeNixPath);

    expect(result).toEqual({ env: {}, ok: true });
  });

  it("should handle spawn exceptions gracefully", async () => {
    mockNix(() => {
      throw new Error("spawn exploded");
    });

    const result = await exportNixEnv(flakeNixPath);

    expect(result).toEqual({
      ok: false,
      reason: "nix print-dev-env failed: Error: spawn exploded",
    });
  });

  it("should skip non-string variable values", async () => {
    mockNix(() => ({
      stdout: JSON.stringify({
        variables: {
          ARRAY_VAL: { type: "exported", value: ["a"] },
          BOOL_VAR: { type: "exported", value: true },
          NULL_VAR: { type: "exported", value: null },
          NUM_VAR: { type: "exported", value: 42 },
          STRING_VAR: { type: "exported", value: "keep" },
        },
      }),
      success: true,
    }));

    const result = await exportNixEnv(flakeNixPath);

    expect(result).toEqual({
      env: { STRING_VAR: "keep" },
      ok: true,
    });
  });

  it("should allow NIX_PATH and other non-build nix vars through", async () => {
    mockNix(() => ({
      stdout: JSON.stringify({
        variables: {
          NIX_BUILD_CORES: { type: "exported", value: "8" },
          NIX_PATH: { type: "exported", value: "nixpkgs=..." },
          NIX_PROFILES: { type: "exported", value: "/nix/var/nix/profiles" },
          NIX_SSL_CERT_FILE: { type: "exported", value: "/etc/ssl/certs" },
        },
      }),
      success: true,
    }));

    const result = await exportNixEnv(flakeNixPath);

    expect(result.ok).toBeTrue();
    if (!result.ok) {
      throw new Error("expected ok");
    }

    // NIX_PATH, NIX_SSL_CERT_FILE, NIX_PROFILES should pass through
    expect(result.env.NIX_PATH).toBe("nixpkgs=...");
    expect(result.env.NIX_SSL_CERT_FILE).toBe("/etc/ssl/certs");
    expect(result.env.NIX_PROFILES).toBe("/nix/var/nix/profiles");
    // NIX_BUILD_* should be filtered
    expect(result.env.NIX_BUILD_CORES).toBeUndefined();
  });

  it("should filter out system identity variables", async () => {
    mockNix(() => ({
      stdout: JSON.stringify({
        variables: {
          CUSTOM_VAR: { type: "exported", value: "keep" },
          HOME: { type: "exported", value: "/homeless-shelter" },
          HOSTNAME: { type: "exported", value: "build-host" },
          LOGNAME: { type: "exported", value: "nixbld" },
          SHELL: { type: "exported", value: "/nix/store/.../bash" },
          USER: { type: "exported", value: "nixbld" },
        },
      }),
      success: true,
    }));

    const result = await exportNixEnv(flakeNixPath);

    expect(result.ok).toBeTrue();
    if (!result.ok) {
      throw new Error("expected ok");
    }

    expect(result.env).toEqual({ CUSTOM_VAR: "keep" });
  });
});
