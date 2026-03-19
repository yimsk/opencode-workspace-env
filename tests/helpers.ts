import { spyOn } from "bun:test";

export type SpawnResult = ReturnType<typeof Bun.spawnSync>;
export type SpawnSpy = ReturnType<typeof spyOn>;

/**
 * Creates a mock spawn result for testing Bun.spawnSync calls.
 */
export function createSpawnResult(options: {
  stderr?: string;
  stdout?: string;
  success: boolean;
}): SpawnResult {
  return {
    exitCode: options.success ? 0 : 1,
    stderr: Buffer.from(options.stderr ?? ""),
    stdout: Buffer.from(options.stdout ?? ""),
    success: options.success,
  } as SpawnResult;
}

/**
 * Manages active spawn spies and provides cleanup via restoreAll().
 */
export class SpawnSpyManager {
  private activeSpies: Array<SpawnSpy> = [];

  /**
   * Register a spy to be tracked for cleanup.
   */
  track(spy: SpawnSpy): void {
    this.activeSpies.push(spy);
  }

  /**
   * Restore all tracked spies. Call this in afterEach.
   */
  restoreAll(): void {
    for (const spy of this.activeSpies.splice(0)) {
      spy.mockRestore();
    }
  }
}

/**
 * Handler function type for mock command responses.
 */
export type MockCommandHandler = (cwd: string) => {
  stderr?: string;
  stdout?: string;
  success: boolean;
};

/**
 * Return type for mockCommand with call tracking.
 */
export interface MockCommandResult {
  /** Number of times the mocked command was invoked */
  calls: number;
  /** Restore the spy to original implementation */
  restore: () => void;
}

/**
 * Mock a specific command in Bun.spawnSync calls.
 * @param commandName - The command name to intercept (e.g., "direnv", "nix")
 * @param handler - Function that returns mock result based on cwd
 * @param manager - Optional SpawnSpyManager to track the spy
 */
export function mockCommand(
  commandName: string,
  handler: MockCommandHandler | (() => { stderr?: string; stdout?: string; success: boolean }),
  manager?: SpawnSpyManager
): MockCommandResult {
  const originalSpawnSync = Bun.spawnSync.bind(Bun);
  let callCount = 0;
  const spawnSpy = spyOn(Bun, "spawnSync");

  if (manager) {
    manager.track(spawnSpy);
  }

  spawnSpy.mockImplementation(((cmd: Array<string>, options?: { cwd?: string }) => {
    if (cmd[0] === commandName) {
      callCount += 1;
      // Handle both (cwd) => result and () => result signatures
      const result =
        handler.length === 0
          ? (handler as () => { stderr?: string; stdout?: string; success: boolean })()
          : handler(options?.cwd ?? "");
      return createSpawnResult(result);
    }
    return originalSpawnSync(cmd, options);
  }) as typeof Bun.spawnSync);

  return {
    get calls() {
      return callCount;
    },
    restore() {
      spawnSpy.mockRestore();
    },
  };
}

/**
 * Mock multiple commands at once (e.g., both nix and direnv).
 */
export function mockCommands(
  handlers: Record<string, MockCommandHandler | undefined>,
  manager?: SpawnSpyManager
): { calls: Record<string, number>; restore: () => void } {
  const originalSpawnSync = Bun.spawnSync.bind(Bun);
  const callCounts: Record<string, number> = {};
  const spawnSpy = spyOn(Bun, "spawnSync");

  if (manager) {
    manager.track(spawnSpy);
  }

  // Initialize call counts
  for (const cmd of Object.keys(handlers)) {
    callCounts[cmd] = 0;
  }

  spawnSpy.mockImplementation(((cmd: Array<string>, options?: { cwd?: string }) => {
    const cmdName = cmd[0];
    const handler = handlers[cmdName];
    if (handler) {
      callCounts[cmdName] = (callCounts[cmdName] ?? 0) + 1;
      const result =
        handler.length === 0
          ? (handler as () => { stderr?: string; stdout?: string; success: boolean })()
          : handler(options?.cwd ?? "");
      return createSpawnResult(result);
    }
    return originalSpawnSync(cmd, options);
  }) as typeof Bun.spawnSync);

  return {
    get calls() {
      return { ...callCounts };
    },
    restore() {
      spawnSpy.mockRestore();
    },
  };
}
