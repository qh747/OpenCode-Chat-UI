#!/usr/bin/env node
/**
 * Release script: full verification pipeline + VSIX packaging.
 *
 * Usage:  npm run release            (verify + package)
 *         node scripts/release.mjs   (same thing)
 * Output: dist/opencode-vscode-<version>.vsix
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
const outFile = path.join(outDir, `opencode-vscode-${version}.vsix`);

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
execFileSync(
  process.platform === "win32" ? "vsce.cmd" : "vsce",
  ["package", "--no-dependencies", "-o", outFile],
  { stdio: "inherit", shell: process.platform === "win32" },
);

if (!existsSync(outFile)) {
  console.error("✖ packaging failed: output not found");
  process.exit(1);
}
console.log(`\n✔ ${path.relative(root, outFile)}`);
