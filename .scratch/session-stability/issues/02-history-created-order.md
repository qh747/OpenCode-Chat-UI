# 02 历史列表创建序：位置不随活动变动

Status: implemented
Type: task

**What to build**（用户视角）：历史菜单与 QuickPick 两处列表按创建时间倒序、按创建时间分日期桶，行时间列显示创建时间——会话位置永不因活动跳位，新建会话出现在顶部且位置随后不变，列表顺序与时间列自洽。

**Blocked by**：None（可立即开始；与工票 01 互相独立）。

事实约束（spec「Implementation Decisions」）：服务器 `GET /api/session` 的 `order` 只按 `time.updated` 排 asc/desc（opencode v2.3.2 `store.ts:156,187`，无自定义排序字段参数）→ **重排在客户端做**，不改请求参数语义。

改动面（spec Q4/Q7 决策）：
- `postHistory`（`src/webview/panel.ts:1288`）：拉取后按 `created` 本地重排。
- `groupHistoryRowsByDate`（`src/util/sessions.ts:57`）：分桶键换 `created`。
- webview 历史行时间列：`relativeSessionTime(row.created)`（`webview-ui/HistoryMenu.tsx:79`）。
- QuickPick（`src/views/historyPicker.ts`）：排序、分桶、description 三处同改。

验收（纯函数 + 渲染用例，先例：`test/sessions.test.ts`、`test/history-menu.test.ts`）：

- [x] 同组内行序 = created 倒序，与各会话 updated 无关（updated 变化不移动行位）
- [x] 日期桶按 created 分：老会话刚有活动也不迁桶
- [x] webview 历史行时间列显示 created 相对时间
- [x] QuickPick 顺序、分组、时间 description 与 webview 菜单一致
- [x] `GLOSSARY.md` 新增「History order」词条（创建序；位置不随活动移动），只写域概念不写实现
- [x] 新用例注册进 `test/run.ts`；全量验证通过

明确不做：拉取窗口偏差（top-100 按 updated，极老静默会话可能缺席）——spec Q4 已披露接受；打开期间实时刷新本来就不存在，不加。

## Comments

**2026-11-22 实施（GLM）**：

- 落点与工单一致：`sortByCreatedDesc`（新纯函数，`src/util/sessions.ts`，返回新数组不改入参，tie 保持传入序）承担客户端重排；`groupHistoryRowsByDate`/`groupSessionsByDate` 分桶键 updated→created；`groupByDate` 参数名 `updatedOf`→`timeOf`（语义改名，私有助手仅两处调用）；`postHistory`（panel.ts）root 前重排；`HistoryMenu.tsx` 时间列 `relativeSessionTime(session.created)`；QuickPick `historyPicker.ts` 排序+description 两处改（分桶随 `groupSessionsByDate` 换键自动同改）。QuickPick 与 webview 的一致性由共享 `sortByCreatedDesc`+同一分桶键结构保证。
- 红绿记录：新文件 `test/history-order.test.ts` 6 用例（注册进 `test/run.ts`）。红分两步：编译红（导出不存在）→ 加占位 stub 跑行为红，6 处全红且原因逐条对上（stub 不排序 ×2、桶 label 'Today'≠'Earlier' ×2、时间列渲染 '3h ago' ×1、行位未锁 ×1）。夹具曾误设 10 天前→期望 'Earlier'，实现正确落在 month 桶，修正夹具为 40 天前（夹具错，非实现错）。绿后精跑全过。
- 语义反转分类（CODING_STANDARDS）：`test/sessions.test.ts` 的 `groupHistoryRowsByDate` 用例锁旧世界观（分桶键=updated）→ 原位翻断言+改名+注释标出处（spec Q7），场景改为 created 10 天前/updated 刚刚，断言结构不变。
- GLOSSARY「History order」词条落在「Row status」后（历史行域概念相邻），只写域概念。
- 验证：全量 527 用例（521 基线 + 6 新）全绿，`npm run typecheck` 过。
- 2026-11-22（code-review 记录）：Standards 轴挂账——`historyPicker.ts` 的 `relativeTime` 与 `sessions.ts` 的 `relativeSessionTime` 为既有双实现（英文硬编码/本地化两版本），本次两处时间列同改 created 使耦合加深；收敛为一超出本工单范围（QuickPick 无渲染接缝），挂账不做。
