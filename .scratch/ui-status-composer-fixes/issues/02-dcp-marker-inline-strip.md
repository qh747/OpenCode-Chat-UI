# 02 DCP `@数字@` 标记回显泄漏

Status: resolved
Type: task

按 spec 分支 2 实施（TDD：`test/dcp-markers.test.ts` 先补失败用例）。验收：句尾粘连标记被剥（`。` → `。`）；reasoning 与导出路径接入过滤；独占一行剥离行为不回归；`。`（标记两侧有字符）不误伤。

## Comments

### 2026-11-17（code-review 修复补充）

- `test/dcp-markers.test.ts` 追加"词尾紧贴标记也剥离"用例，锁定 Q15 边界（前缀不限制）；spec.md 分支 2 边界表述同步修正。
### 2026-11-17

- TDD：先更新 `test/dcp-markers.test.ts`（两条"行尾粘连保留"用例改为剥离 + 新增"紧粘句尾"用例），确认红灯。
- `src/util/dcp-markers.ts`：`TRAILING_TAG` 去掉 `(?:^|\n)[ \t]*` 行首前缀约束，仅要求"标记之后到文本末尾仅剩空白"；同步更新注释说明边界变更依据（用户决策 Q15）。225 测试全绿。
- `webview-ui/MessageList.tsx:162` ThinkingRow 的 reasoning 文本接入 `stripTrailingMarkers`（该文件原本已导入该函数）。
- `src/webview/panel.ts` 导出路径：assistant text 与 reasoning 均接入同一过滤。
- typecheck / lint 通过。文件含 `@数字@` 字面标记，编辑经由临时 Node 脚本操作真实字节完成（脚本已清理）。

