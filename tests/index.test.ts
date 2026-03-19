import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Hooks, PluginInput } from "@opencode-ai/plugin";

const repoRoot = join(import.meta.dir, "..");
const scratchRoot = join(repoRoot, ".sisyphus");
mkdirSync(scratchRoot, { recursive: true });
const defaultModulePath = join(repoRoot, "dist/index.js");
const expectedHookKeys = ["shell.env"] as const;

interface PluginModuleLike {
  default: unknown;
  description?: unknown;
  name?: unknown;
  version?: unknown;
}

type PluginContract = (input: PluginInput) => Promise<Hooks>;

function createPluginInput(): PluginInput {
  return {
    $: {} as PluginInput["$"],
    client: {} as PluginInput["client"],
    directory: process.cwd(),
    project: {} as PluginInput["project"],
    serverUrl: new URL("https://example.com"),
    worktree: process.cwd(),
  };
}

function createCompliantPluginFixture(): { cleanup: () => void; modulePath: string } {
  const tempDir = mkdtempSync(join(scratchRoot, "plugin-contract-fixture-"));
  const modulePath = join(tempDir, "plugin-fixture.js");
  const typesPath = join(tempDir, "plugin-fixture.d.ts");

  writeFileSync(
    modulePath,
    [
      'export const name = "opencode-workspace-env";',
      'export const version = "0.1.0";',
      'export const description = "OpenCode plugin for per-workspace env injection via shell.env hook";',
      "",
      "export default async function plugin(_input) {",
      "  return {",
      '    "shell.env": async () => {},',
      "  };",
      "}",
    ].join("\n")
  );

  writeFileSync(
    typesPath,
    [
      'import type { Hooks, PluginInput } from "@opencode-ai/plugin";',
      'export declare const name = "opencode-workspace-env";',
      'export declare const version = "0.1.0";',
      'export declare const description = "OpenCode plugin for per-workspace env injection via shell.env hook";',
      "export default function plugin(_input: PluginInput): Promise<Hooks>;",
    ].join("\n")
  );

  return {
    cleanup: () => rmSync(tempDir, { force: true, recursive: true }),
    modulePath,
  };
}

async function withResolvedPluginTarget<T>(
  fn: (target: { modulePath: string }) => Promise<T> | T
): Promise<T> {
  if (process.env.WORKSPACE_ENV_PLUGIN_TARGET === "fixture") {
    const fixture = createCompliantPluginFixture();

    try {
      return await fn({ modulePath: fixture.modulePath });
    } finally {
      fixture.cleanup();
    }
  }

  return await fn({ modulePath: defaultModulePath });
}

function compilePluginContract(modulePath: string) {
  const tempDir = mkdtempSync(join(scratchRoot, "plugin-contract-compile-"));
  const entryPath = join(tempDir, "plugin-contract.ts");

  writeFileSync(
    entryPath,
    [
      `import plugin from ${JSON.stringify(modulePath)};`,
      'import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin";',
      "",
      "const sdkPlugin: Plugin = plugin;",
      "declare const input: PluginInput;",
      "const hooksPromise = sdkPlugin(input);",
      "const typedHooksPromise: Promise<Hooks> = hooksPromise;",
      "void typedHooksPromise;",
    ].join("\n")
  );

  const result = Bun.spawnSync({
    cmd: [
      "bun",
      "x",
      "tsc",
      "--noEmit",
      "--strict",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      "--skipLibCheck",
      "--types",
      "bun,node",
      entryPath,
    ],
    cwd: repoRoot,
    stderr: "pipe",
    stdout: "pipe",
  });

  const stderr = new TextDecoder().decode(result.stderr);
  const stdout = new TextDecoder().decode(result.stdout);

  rmSync(tempDir, { force: true, recursive: true });

  return {
    exitCode: result.exitCode,
    stderr,
    stdout,
  };
}

async function loadPluginModule(modulePath: string): Promise<PluginModuleLike> {
  return (await import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`)) as PluginModuleLike;
}

describe("opencode-workspace-env entrypoint contract", () => {
  it("keeps named metadata exports aligned with package contract", async () => {
    await withResolvedPluginTarget(async ({ modulePath }) => {
      const mod = await loadPluginModule(modulePath);

      expect(mod.name).toBe("opencode-workspace-env");
      expect(mod.version).toBe("0.1.0");
      expect(mod.description).toBe(
        "OpenCode plugin for per-workspace env injection via shell.env hook"
      );
    });
  });

  it("typechecks default export as SDK Plugin", async () => {
    await withResolvedPluginTarget(async ({ modulePath }) => {
      const result = compilePluginContract(modulePath);

      expect(result.exitCode, `${result.stdout}\n${result.stderr}`.trim()).toBe(0);
    });
  }, 30_000);

  it("returns Hooks from async plugin init", async () => {
    await withResolvedPluginTarget(async ({ modulePath }) => {
      const mod = await loadPluginModule(modulePath);

      expect(typeof mod.default).toBe("function");

      const plugin = mod.default as unknown as PluginContract;

      const hooks = await plugin(createPluginInput());

      expect(hooks).toEqual(
        expect.objectContaining({
          [expectedHookKeys[0]]: expect.any(Function),
        })
      );
      expect(hooks).not.toHaveProperty("register");
    });
  });
});
