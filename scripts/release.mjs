#!/usr/bin/env node
/**
 * Release script: full verification pipeline + VSIX packaging.
 *
 * Usage:  npm run release            (verify + package)
 *         node scripts/release.mjs   (same thing)
 * Output: dist/<extension-name>-<version>.vsix
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.chdir(root);

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const version = pkg.version;
const outDir = path.join(root, "dist");
// 产物文件名跟显示名走（opencode-sidebar-<version>.vsix）：文件名是给人看
// 的，市场身份由 pkg.name（扩展 ID quhan.opencode-plugin）决定。
const artifactName = pkg.displayName.toLowerCase().replace(/\s+/g, "-");
const outFile = path.join(outDir, `${artifactName}-${version}.vsix`);

function step(name, command, args) {
  console.log(`\n▶ ${name}`);
  execFileSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
}

console.log(`Packaging ${pkg.name}@${version}`);

step("typecheck", "npm", ["run", "typecheck"]);
step("lint", "npm", ["run", "lint"]);
step("test", "npm", ["test"]);
step("compile", "npm", ["run", "compile"]);

// Warn if the marketplace icon is missing (icon field requires a PNG).
if (!existsSync(path.join(root, "icons", "marketplace.png"))) {
  console.error("✖ icons/marketplace.png missing — required by the package.json icon field");
  process.exit(1);
}

rmSync(outFile, { force: true });
mkdirSync(outDir, { recursive: true });

console.log("\n▶ vsce package");
// vsce 在 devDependencies 里，从本地 .bin 解析——不要求全局安装。
const vsceBin = path.join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "vsce.cmd" : "vsce",
);
execFileSync(
  vsceBin,
  ["package", "--no-dependencies", "-o", outFile],
  { stdio: "inherit", shell: process.platform === "win32" },
);

if (!existsSync(outFile)) {
  console.error("✖ packaging failed: output not found");
  process.exit(1);
}
console.log(`\n✔ ${path.relative(root, outFile)}`);
