import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Hooks, PluginInput } from "@opencode-ai/plugin";
import { mockCommand, mockCommands, SpawnSpyManager } from "./helpers";

const repoRoot = join(import.meta.dir, "..");

type PluginContract = (input: PluginInput) => Promise<Hooks>;
type ShellEnvHook = (
  input: { callID?: string; cwd: string; sessionID?: string },
  output: { env: Record<string, string> }
) => Promise<void>;

const tempDirs: Array<string> = [];
const spyManager = new SpawnSpyManager();

function createPluginInput(directory: string): PluginInput {
  return {
    $: {} as PluginInput["$"],
    client: {} as PluginInput["client"],
    directory,
    project: {} as PluginInput["project"],
    serverUrl: new URL("https://example.com"),
    worktree: directory,
  };
}

function createTempGitRepo(options?: {
  envrcContent?: string;
  flakeLockContent?: string;
  flakeNixContent?: string;
  withEnvrc?: boolean;
}) {
  const tempDir = mkdtempSync(join(tmpdir(), "workspace-env-integration-"));
  tempDirs.push(tempDir);

  const gitRoot = join(tempDir, "repo");
  const cwd = join(gitRoot, "apps", "web");
  mkdirSync(cwd, { recursive: true });

  const init = Bun.spawnSync(["git", "init"], { cwd: gitRoot });
  if (!init.success) {
    throw new Error(`git init failed: ${init.stderr.toString()}`);
  }

  const envrcPath = join(gitRoot, ".envrc");
  if (options?.withEnvrc !== false) {
    writeFileSync(envrcPath, options?.envrcContent ?? "export TEST_VAR=initial");
  }

  const flakeLockPath = join(gitRoot, "flake.lock");
  if (options?.flakeLockContent) {
    writeFileSync(flakeLockPath, options.flakeLockContent);
  }

  const flakeNixPath = join(gitRoot, "flake.nix");
  if (options?.flakeNixContent) {
    writeFileSync(flakeNixPath, options.flakeNixContent);
  }

  return { cwd, envrcPath, flakeLockPath, flakeNixPath, gitRoot };
}

async function loadShellEnvHook(cwd: string): Promise<ShellEnvHook> {
  const moduleUrl = `${pathToFileURL(join(repoRoot, "src/index.ts")).href}?t=${Date.now()}-${Math.random()}`;
  const mod = (await import(moduleUrl)) as { default: PluginContract };
  const hooks = await mod.default(createPluginInput(cwd));
  const hook = hooks["shell.env"];

  if (typeof hook !== "function") {
    throw new Error("shell.env hook missing");
  }

  return hook as ShellEnvHook;
}

function mockDirenv(
  handler: (cwd: string) => { stderr?: string; stdout?: string; success: boolean }
) {
  const mock = mockCommand("direnv", handler, spyManager);
  return {
    get direnvCalls() {
      return mock.calls;
    },
    restore() {
      mock.restore();
    },
  };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { force: true, recursive: true });
  }

  spyManager.restoreAll();
});

describe("workspace env plugin integration", () => {
  it("resolves cwd through hook and returns exported env on happy path", async () => {
    const repo = createTempGitRepo({
      envrcContent: "export TEST_VAR=initial",
      flakeLockContent: '{"version":1}',
    });
    const direnv = mockDirenv(() => ({
      stdout: JSON.stringify({
        DIRENV_DIR: "/internal",
        EXTRA_VAR: "present",
        NULL_VAR: null,
        TEST_VAR: "initial",
      }),
      success: true,
    }));

    const hook = await loadShellEnvHook(repo.cwd);
    const output: { env: Record<string, string> } = {
      env: { SHOULD_BE_REPLACED: "nope" },
    };

    await hook({ cwd: repo.cwd }, output);

    expect(output.env).toEqual({
      EXTRA_VAR: "present",
      TEST_VAR: "initial",
    });
    expect(direnv.direnvCalls).toBe(1);

    direnv.restore();
  });

  it("returns empty env when no .envrc exists", async () => {
    const repo = createTempGitRepo({ withEnvrc: false });
    const direnv = mockDirenv(() => ({
      stdout: JSON.stringify({ SHOULD_NOT: "run" }),
      success: true,
    }));

    const hook = await loadShellEnvHook(repo.cwd);
    const output: { env: Record<string, string> } = {
      env: { PREVIOUS: "value" },
    };

    await hook({ cwd: repo.cwd }, output);

    expect(output.env).toEqual({});
    expect(direnv.direnvCalls).toBe(0);

    direnv.restore();
  });

  it("returns empty env when direnv fails", async () => {
    const repo = createTempGitRepo();
    const direnv = mockDirenv(() => ({
      stderr: "direnv: command not found",
      success: false,
    }));

    const hook = await loadShellEnvHook(repo.cwd);
    const output = { env: {} };

    await hook({ cwd: repo.cwd }, output);

    expect(output.env).toEqual({});
    expect(direnv.direnvCalls).toBe(1);

    direnv.restore();
  });

  it("returns empty env when direnv output is malformed", async () => {
    const repo = createTempGitRepo();
    const direnv = mockDirenv(() => ({
      stdout: "direnv warning\nnot-json",
      success: true,
    }));

    const hook = await loadShellEnvHook(repo.cwd);
    const output = { env: {} };

    await hook({ cwd: repo.cwd }, output);

    expect(output.env).toEqual({});
    expect(direnv.direnvCalls).toBe(1);

    direnv.restore();
  });

  it("fails silent when direnv invocation throws", async () => {
    const repo = createTempGitRepo();
    const direnv = mockDirenv(() => {
      throw new Error("spawn exploded");
    });

    const hook = await loadShellEnvHook(repo.cwd);
    const output: { env: Record<string, string> } = {
      env: { PREVIOUS: "value" },
    };

    await hook({ cwd: repo.cwd }, output);

    expect(output.env).toEqual({});
    expect(direnv.direnvCalls).toBe(1);

    direnv.restore();
  });

  it("does not traverse above git root when higher parent has .envrc", async () => {
    const repo = createTempGitRepo({ withEnvrc: false });
    const direnv = mockDirenv(() => ({
      stdout: JSON.stringify({ SHOULD_NOT: "run" }),
      success: true,
    }));

    writeFileSync(join(dirname(repo.gitRoot), ".envrc"), "export SHOULD_NOT_SEE=this");

    const hook = await loadShellEnvHook(repo.cwd);
    const output: { env: Record<string, string> } = {
      env: { PREVIOUS: "value" },
    };

    await hook({ cwd: repo.cwd }, output);

    expect(output.env).toEqual({});
    expect(direnv.direnvCalls).toBe(0);

    direnv.restore();
  });

  it("writes only to output.env and leaves process.env untouched", async () => {
    const repo = createTempGitRepo();
    const direnv = mockDirenv(() => ({
      stdout: JSON.stringify({ TEST_VAR: "from-direnv" }),
      success: true,
    }));
    const originalSentinel = process.env.WORKSPACE_ENV_TEST_SENTINEL;

    process.env.WORKSPACE_ENV_TEST_SENTINEL = "keep";

    try {
      const hook = await loadShellEnvHook(repo.cwd);
      const output = { env: {} };

      await hook({ cwd: repo.cwd }, output);

      expect(output.env).toEqual({ TEST_VAR: "from-direnv" });
      expect(process.env.WORKSPACE_ENV_TEST_SENTINEL).toBe("keep");
      expect(process.env.TEST_VAR).not.toBe("from-direnv");
    } finally {
      if (originalSentinel === undefined) {
        delete process.env.WORKSPACE_ENV_TEST_SENTINEL;
      } else {
        process.env.WORKSPACE_ENV_TEST_SENTINEL = originalSentinel;
      }
      direnv.restore();
    }
  });

  it("hits cache, then invalidates after .envrc changes", async () => {
    const repo = createTempGitRepo({
      envrcContent: "export TEST_VAR=initial",
      flakeLockContent: '{"version":1}',
    });
    const direnv = mockDirenv((cwd) => {
      const envrc = readFileSync(join(cwd, ".envrc"), "utf8");
      const value = envrc.includes("changed") ? "changed" : "initial";

      return {
        stdout: JSON.stringify({ TEST_VAR: value }),
        success: true,
      };
    });

    const hook = await loadShellEnvHook(repo.cwd);

    const first = { env: {} };
    await hook({ cwd: repo.cwd }, first);

    const second = { env: {} };
    await hook({ cwd: repo.cwd }, second);

    writeFileSync(repo.envrcPath, "export TEST_VAR=changed");

    const third = { env: {} };
    await hook({ cwd: repo.cwd }, third);

    expect(first.env).toEqual({ TEST_VAR: "initial" });
    expect(second.env).toEqual({ TEST_VAR: "initial" });
    expect(third.env).toEqual({ TEST_VAR: "changed" });
    expect(direnv.direnvCalls).toBe(2);

    direnv.restore();
  });

  it("invalidates cache when flake.lock changes", async () => {
    const repo = createTempGitRepo({
      envrcContent: "use flake",
      flakeLockContent: '{"version":1}',
    });
    const direnv = mockDirenv(() => {
      const flakeLock = readFileSync(repo.flakeLockPath, "utf8");
      const value = flakeLock.includes('"version":2') ? "v2" : "v1";

      return {
        stdout: JSON.stringify({ TEST_VAR: value }),
        success: true,
      };
    });

    const hook = await loadShellEnvHook(repo.cwd);

    const first: { env: Record<string, string> } = { env: {} };
    await hook({ cwd: repo.cwd }, first);

    const second: { env: Record<string, string> } = { env: {} };
    await hook({ cwd: repo.cwd }, second);

    writeFileSync(repo.flakeLockPath, '{"version":2}');

    const third: { env: Record<string, string> } = { env: {} };
    await hook({ cwd: repo.cwd }, third);

    expect(first.env).toEqual({ TEST_VAR: "v1" });
    expect(second.env).toEqual({ TEST_VAR: "v1" });
    expect(third.env).toEqual({ TEST_VAR: "v2" });
    expect(direnv.direnvCalls).toBe(2);

    direnv.restore();
  });

  it("does not cache failed direnv exports", async () => {
    const repo = createTempGitRepo({
      envrcContent: "export TEST_VAR=recovered",
      flakeLockContent: '{"version":1}',
    });
    let attempt = 0;
    const direnv = mockDirenv(() => {
      attempt += 1;

      if (attempt === 1) {
        return {
          stderr: "temporary direnv failure",
          success: false,
        };
      }

      return {
        stdout: JSON.stringify({ TEST_VAR: "recovered" }),
        success: true,
      };
    });

    const hook = await loadShellEnvHook(repo.cwd);

    const first = { env: {} };
    await hook({ cwd: repo.cwd }, first);

    const second = { env: {} };
    await hook({ cwd: repo.cwd }, second);

    expect(first.env).toEqual({});
    expect(second.env).toEqual({ TEST_VAR: "recovered" });
    expect(direnv.direnvCalls).toBe(2);

    direnv.restore();
  });

  it("caches successful empty env exports", async () => {
    const repo = createTempGitRepo({
      envrcContent: "# no exports",
      flakeLockContent: '{"version":1}',
    });
    const direnv = mockDirenv(() => ({
      stdout: JSON.stringify({ DIRENV_DIR: "/internal", NULL_VAR: null }),
      success: true,
    }));

    const hook = await loadShellEnvHook(repo.cwd);

    const first: { env: Record<string, string> } = {
      env: { PREVIOUS: "value" },
    };
    await hook({ cwd: repo.cwd }, first);

    const second: { env: Record<string, string> } = {
      env: { PREVIOUS: "value" },
    };
    await hook({ cwd: repo.cwd }, second);

    expect(first.env).toEqual({});
    expect(second.env).toEqual({});
    expect(direnv.direnvCalls).toBe(1);

    direnv.restore();
  });

  it("keeps cache isolated per workspace .envrc path", async () => {
    const repoA = createTempGitRepo({
      envrcContent: "export TEST_VAR=repo-a",
      flakeLockContent: '{"version":1}',
    });
    const repoB = createTempGitRepo({
      envrcContent: "export TEST_VAR=repo-b",
      flakeLockContent: '{"version":1}',
    });
    const direnv = mockDirenv((cwd) => ({
      stdout: JSON.stringify({
        TEST_VAR: cwd === repoA.gitRoot ? "repo-a" : "repo-b",
      }),
      success: true,
    }));

    const hookA = await loadShellEnvHook(repoA.cwd);
    const hookB = await loadShellEnvHook(repoB.cwd);

    const firstA = { env: {} };
    await hookA({ cwd: repoA.cwd }, firstA);

    const firstB = { env: {} };
    await hookB({ cwd: repoB.cwd }, firstB);

    const secondA = { env: {} };
    await hookA({ cwd: repoA.cwd }, secondA);

    expect(firstA.env).toEqual({ TEST_VAR: "repo-a" });
    expect(firstB.env).toEqual({ TEST_VAR: "repo-b" });
    expect(secondA.env).toEqual({ TEST_VAR: "repo-a" });
    expect(direnv.direnvCalls).toBe(2);

    direnv.restore();
  });
});

function mockNixAndDirenv(handlers: {
  direnv?: (cwd: string) => { stderr?: string; stdout?: string; success: boolean };
  nix?: (cwd: string) => { stderr?: string; stdout?: string; success: boolean };
}) {
  const mock = mockCommands({ direnv: handlers.direnv, nix: handlers.nix }, spyManager);
  return {
    get direnvCalls() {
      return mock.calls.direnv ?? 0;
    },
    get nixCalls() {
      return mock.calls.nix ?? 0;
    },
    restore() {
      mock.restore();
    },
  };
}

describe("flake.nix fallback integration", () => {
  it("uses nix print-dev-env when only flake.nix exists (no .envrc)", async () => {
    const repo = createTempGitRepo({
      flakeLockContent: '{"version":1}',
      flakeNixContent: "{ outputs = { ... }: {}; }",
      withEnvrc: false,
    });
    const mock = mockNixAndDirenv({
      nix: () => ({
        stdout: JSON.stringify({
          variables: {
            CUSTOM: { type: "exported", value: "from-nix" },
            name: { type: "exported", value: "dev-shell" },
            PATH: { type: "exported", value: "/nix/store/...:..." },
          },
        }),
        success: true,
      }),
    });

    const hook = await loadShellEnvHook(repo.cwd);
    const output = { env: {} };
    await hook({ cwd: repo.cwd }, output);

    expect(output.env).toEqual({
      CUSTOM: "from-nix",
      PATH: "/nix/store/...:...",
    });
    expect(mock.nixCalls).toBe(1);
    expect(mock.direnvCalls).toBe(0);

    mock.restore();
  });

  it("prefers .envrc over flake.nix when both exist", async () => {
    const repo = createTempGitRepo({
      envrcContent: "use flake",
      flakeLockContent: '{"version":1}',
      flakeNixContent: "{ outputs = { ... }: {}; }",
    });
    const mock = mockNixAndDirenv({
      direnv: () => ({
        stdout: JSON.stringify({ FROM_DIRENV: "yes" }),
        success: true,
      }),
      nix: () => ({
        stdout: JSON.stringify({
          variables: { FROM_NIX: { type: "exported", value: "yes" } },
        }),
        success: true,
      }),
    });

    const hook = await loadShellEnvHook(repo.cwd);
    const output = { env: {} };
    await hook({ cwd: repo.cwd }, output);

    expect(output.env).toEqual({ FROM_DIRENV: "yes" });
    expect(mock.direnvCalls).toBe(1);
    expect(mock.nixCalls).toBe(0);

    mock.restore();
  });

  it("returns empty env when nix fails on flake-only repo", async () => {
    const repo = createTempGitRepo({
      flakeNixContent: "{ outputs = { ... }: {}; }",
      withEnvrc: false,
    });
    const mock = mockNixAndDirenv({
      nix: () => ({
        stderr: "error: getting flake",
        success: false,
      }),
    });

    const hook = await loadShellEnvHook(repo.cwd);
    const output = { env: {} };
    await hook({ cwd: repo.cwd }, output);

    expect(output.env).toEqual({});
    expect(mock.nixCalls).toBe(1);

    mock.restore();
  });

  it("caches nix env and invalidates on flake.nix change", async () => {
    const repo = createTempGitRepo({
      flakeLockContent: '{"version":1}',
      flakeNixContent: "{ outputs = { ... }: {}; }",
      withEnvrc: false,
    });
    let callCount = 0;
    const mock = mockNixAndDirenv({
      nix: () => {
        callCount += 1;
        return {
          stdout: JSON.stringify({
            variables: {
              CALL: { type: "exported", value: String(callCount) },
            },
          }),
          success: true,
        };
      },
    });

    const hook = await loadShellEnvHook(repo.cwd);

    const first = { env: {} };
    await hook({ cwd: repo.cwd }, first);

    const second = { env: {} };
    await hook({ cwd: repo.cwd }, second);

    // Change flake.nix to invalidate cache
    writeFileSync(repo.flakeNixPath, "{ outputs = { ... }: { changed = true; }; }");

    const third = { env: {} };
    await hook({ cwd: repo.cwd }, third);

    expect(first.env).toEqual({ CALL: "1" });
    expect(second.env).toEqual({ CALL: "1" }); // cached
    expect(third.env).toEqual({ CALL: "2" }); // invalidated
    expect(mock.nixCalls).toBe(2);

    mock.restore();
  });

  it("caches nix env and invalidates on flake.lock change", async () => {
    const repo = createTempGitRepo({
      flakeLockContent: '{"version":1}',
      flakeNixContent: "{ outputs = { ... }: {}; }",
      withEnvrc: false,
    });
    let callCount = 0;
    const mock = mockNixAndDirenv({
      nix: () => {
        callCount += 1;
        return {
          stdout: JSON.stringify({
            variables: {
              VER: { type: "exported", value: `v${callCount}` },
            },
          }),
          success: true,
        };
      },
    });

    const hook = await loadShellEnvHook(repo.cwd);

    const first: { env: Record<string, string> } = { env: {} };
    await hook({ cwd: repo.cwd }, first);

    const second: { env: Record<string, string> } = { env: {} };
    await hook({ cwd: repo.cwd }, second);

    writeFileSync(repo.flakeLockPath, '{"version":2}');

    const third: { env: Record<string, string> } = { env: {} };
    await hook({ cwd: repo.cwd }, third);

    expect(first.env).toEqual({ VER: "v1" });
    expect(second.env).toEqual({ VER: "v1" });
    expect(third.env).toEqual({ VER: "v2" });
    expect(mock.nixCalls).toBe(2);

    mock.restore();
  });

  it("does not cache failed nix exports", async () => {
    const repo = createTempGitRepo({
      flakeLockContent: '{"version":1}',
      flakeNixContent: "{ outputs = { ... }: {}; }",
      withEnvrc: false,
    });
    let attempt = 0;
    const mock = mockNixAndDirenv({
      nix: () => {
        attempt += 1;
        if (attempt === 1) {
          return { stderr: "temporary failure", success: false };
        }
        return {
          stdout: JSON.stringify({
            variables: {
              RECOVERED: { type: "exported", value: "yes" },
            },
          }),
          success: true,
        };
      },
    });

    const hook = await loadShellEnvHook(repo.cwd);

    const first = { env: {} };
    await hook({ cwd: repo.cwd }, first);

    const second = { env: {} };
    await hook({ cwd: repo.cwd }, second);

    expect(first.env).toEqual({});
    expect(second.env).toEqual({ RECOVERED: "yes" });
    expect(mock.nixCalls).toBe(2);

    mock.restore();
  });
});
