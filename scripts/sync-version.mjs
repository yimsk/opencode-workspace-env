#!/usr/bin/env node
// Sync src/index.ts version with package.json after changeset version
import { readFileSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const indexPath = "src/index.ts";
const content = readFileSync(indexPath, "utf8");
const updated = content.replace(
  /export const version = "[^"]+"/,
  `export const version = "${pkg.version}"`
);
if (content !== updated) {
  writeFileSync(indexPath, updated);
  console.log(`synced src/index.ts version to ${pkg.version}`);
}
