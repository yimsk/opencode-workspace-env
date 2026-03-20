import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const indexPath = join(root, "src/index.ts");

const src = readFileSync(indexPath, "utf8");
const updated = src.replace(
  /export const version = "[^"]+"/,
  `export const version = "${pkg.version}"`
);

if (src !== updated) {
  writeFileSync(indexPath, updated);
  console.log(`synced version to ${pkg.version}`);
} else {
  console.log(`version already ${pkg.version}`);
}
