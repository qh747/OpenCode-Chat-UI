#!/usr/bin/env node
/**
 * Marketplace display-name prefilter, run by release.mjs before `vsce package`.
 *
 * 判定规则（实证与证据链见 .scratch/opencode-sidebar/issues/03-rename-opencode-sidebar.md
 * 的 2026-11-22 追记；publish 是最终判定，本预筛只为省一轮返工）：
 *   - 新 displayName 与现有 displayName 规范化后逐字相等 → 拒；
 *   - 新 displayName 是某个现有 displayName 的规范化前缀（新名更短）→ 拒
 *     （实证：publish "OpenCode Sidebar" 被拒，它是 "Opencode Sidebar Chat"
 *     等一批变体的前缀）；
 *   - 新名以现有名开头（新名更长）→ 不拒
 *     （反证：一批 "OpenCode Xxx" 第三方显示名以官方扩展的 "opencode"
 *     为前缀仍发布成功，含 Mrakulis/agustin-gigena/amr-s-elzoghby 等）。
 * 规范化 = lowercase + 折叠空白。Marketplace API 不可达时警告放行：
 * 拦不到的由 vsce publish 自己拦，预筛不阻断发布。
 *
 * displayName 的同步点（改显示名时一起改；VSIX 文件名由本管线从
 * displayName 派生，无需单独改）：
 *   package.json displayName、README.md 与 README.zh-CN.md 标题及安装
 *   路径、LICENSE 署名行、GLOSSARY.md 首行。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const displayName = pkg.displayName ?? "";
if (!displayName) {
  console.error("✖ package.json has no displayName");
  process.exit(1);
}

const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();

const res = await fetch(
  "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json;api-version=3.0-preview.1",
    },
    body: JSON.stringify({
      filters: [
        { criteria: [{ filterType: 10, value: displayName }], pageNumber: 1, pageSize: 100 },
      ],
      flags: 914,
    }),
    signal: AbortSignal.timeout(15_000),
  },
);

if (!res.ok) {
  console.warn(
    `⚠ display-name prefilter unavailable (HTTP ${res.status}) — vsce publish remains the final arbiter`,
  );
  process.exit(0);
}

const data = await res.json();
const extensions = data.results?.[0]?.extensions ?? [];
const normNew = norm(displayName);
const exact = [];
const prefixes = [];
for (const ext of extensions) {
  const id = `${ext.publisher?.publisherName ?? "?"}.${ext.extensionName ?? "?"}`;
  const normExisting = norm(ext.displayName ?? "");
  if (normExisting === normNew) {
    exact.push(`${id}  [${ext.displayName}]`);
  } else if (normExisting.startsWith(normNew)) {
    prefixes.push(`${id}  [${ext.displayName}]`);
  }
}

if (exact.length === 0 && prefixes.length === 0) {
  console.log(
    `✔ display name "${displayName}" passes the marketplace prefilter (${extensions.length} scanned)`,
  );
  process.exit(0);
}

console.error(`✖ display name "${displayName}" collides on the Marketplace:`);
for (const hit of [...exact, ...prefixes]) {
  console.error(`    ${hit}`);
}
console.error("  publish would be rejected — pick a longer or a different display name");
process.exit(1);
