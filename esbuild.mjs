import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");
const tests = process.argv.includes("--tests");

/** @type {import('esbuild').BuildOptions} */
const extension = {
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  external: ["vscode"],
  // jsonc-parser's UMD build shadows `require` inside its factory, so esbuild
  // cannot follow it; the ESM build is plain imports and bundles cleanly.
  mainFields: ["module", "main"],
  sourcemap: true,
  minify: false,
  logLevel: "info",
};

/** @type {import('esbuild').BuildOptions} */
const webview = {
  entryPoints: ["webview-ui/main.tsx"],
  outfile: "dist/webview.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  sourcemap: false,
  minify: true,
  logLevel: "info",
  define: { "process.env.NODE_ENV": '"production"' },
};

/** @type {import('esbuild').BuildOptions} */
const settings = {
  entryPoints: ["webview-ui/settings.tsx"],
  outfile: "dist/settings.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  sourcemap: false,
  minify: true,
  logLevel: "info",
  define: { "process.env.NODE_ENV": '"production"' },
};

/** @type {import('esbuild').BuildOptions} */
const testBuild = {
  entryPoints: ["test/run.ts"],
  outfile: "out/tests.cjs",
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  external: ["vscode"],
  mainFields: ["module", "main"],
  sourcemap: false,
  minify: true,
  logLevel: "info",
};

const builds = tests ? [testBuild] : [extension, webview, settings];

if (watch) {
  const contexts = await Promise.all(builds.map((b) => esbuild.context(b)));
  await Promise.all(contexts.map((c) => c.watch()));
  console.log("watching...");
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
