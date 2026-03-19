import { describe, expect, it } from "bun:test";
import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = resolve(__dirname, "..");

async function loadPackage(): Promise<Record<string, unknown>> {
  const pkgPath = join(cwd, "package.json");
  const content = await readFile(pkgPath, "utf8");
  return JSON.parse(content);
}

async function loadTsConfig(): Promise<Record<string, unknown>> {
  const configPath = join(cwd, "tsconfig.json");
  const content = await readFile(configPath, "utf8");
  return JSON.parse(content);
}

describe("package.json contract", async () => {
  const pkg = await loadPackage();

  it("should have type: module", () => {
    expect(pkg.type).toBe("module");
  });

  it("should have main entry point", () => {
    expect(pkg.main).toBe("dist/index.js");
  });

  it("should have types entry point", () => {
    expect(pkg.types).toBe("dist/index.d.ts");
  });

  it("should have all required scripts", () => {
    const requiredScripts = ["test", "build", "typecheck", "lint", "check", "format"];
    for (const script of requiredScripts) {
      expect(pkg.scripts[script]).toBeDefined();
      expect(pkg.scripts[script]).not.toBe("");
    }
  });

  it("should use bun test for test script", () => {
    expect(pkg.scripts.test).toBe("bun test");
  });

  it("should use tsc for build script", () => {
    expect(pkg.scripts.build).toBe("tsc");
  });

  it("should use tsgo --noEmit for typecheck script", () => {
    expect(pkg.scripts.typecheck).toBe("tsgo --noEmit");
  });

  it("should have @opencode-ai/plugin as peerDependency", () => {
    expect(pkg.peerDependencies).toBeDefined();
    expect(pkg.peerDependencies["@opencode-ai/plugin"]).toBe("*");
  });

  it("should have correct name", () => {
    expect(pkg.name).toBe("opencode-workspace-env");
  });
});

describe("tsconfig.json contract", async () => {
  const tsconfig = await loadTsConfig();

  it("should target ES2022", () => {
    expect(tsconfig.compilerOptions.target).toBe("ES2022");
  });

  it("should use NodeNext module resolution", () => {
    expect(tsconfig.compilerOptions.module).toBe("NodeNext");
    expect(tsconfig.compilerOptions.moduleResolution).toBe("NodeNext");
  });

  it("should output to dist directory", () => {
    expect(tsconfig.compilerOptions.outDir).toBe("./dist");
  });

  it("should have strict mode enabled", () => {
    expect(tsconfig.compilerOptions.strict).toBe(true);
  });

  it("should include bun types", () => {
    expect(tsconfig.compilerOptions.types).toContain("bun");
  });
});

describe("publish contract guards", async () => {
  const pkg = await loadPackage();
  const cwd = resolve(dirname(fileURLToPath(import.meta.url)), "..");

  it("should have version aligned with src/index.ts", async () => {
    const indexPath = join(cwd, "src", "index.ts");
    const indexContent = await readFile(indexPath, "utf8");
    const versionMatch = indexContent.match(/export const version = "([^"]+)"/);
    const indexVersion = versionMatch ? versionMatch[1] : null;
    expect(indexVersion).toBe(pkg.version);
  });

  it("should have README.md present for publish", async () => {
    const readmePath = join(cwd, "README.md");
    let readmeExists = false;
    try {
      await access(readmePath);
      readmeExists = true;
    } catch {
      readmeExists = false;
    }
    expect(readmeExists).toBe(true);
  });

  it("should have LICENSE file present for publish", async () => {
    const licensePath = join(cwd, "LICENSE");
    let licenseExists = false;
    try {
      await access(licensePath);
      licenseExists = true;
    } catch {
      licenseExists = false;
    }
    expect(licenseExists).toBe(true);
  });
});
