# 03 `@` 误触发文件补全卡死

Status: resolved
Type: task

按 spec 分支 3 实施。验收：无匹配自动关弹层且 Enter 可发送；补全按光标前缀触发；IME composition 期间不触发；Esc 抑制存续到尾部 `@` 删除或空格；`/` 命令补全同规则。可测逻辑抽到 `src/util`（TDD seam）。

## Comments

### 2026-11-17（code-review 修复补充）

- Spec 轴审查指出实现与 spec 文本偏差：spec 明文"`@` 后出现空格才解除抑制"，原实现只处理了删除场景。已修：`handleChange` 中 `value[suppressedAt + 1] === " "` 也解除抑制（空格本身已断尾部匹配，弹层即时关闭；之后删除空格重新打字可正常触发）。
### 2026-11-17

- 新增 TDD seam：`src/util/mention-trigger.ts` 的 `mentionTail(text, caret)`（光标前缀尾部 `@` 检测，返回 query/atIndex/caret）+ `test/mention-trigger.test.ts` 7 用例（光标移走不触发、空格断尾、越界钳制等）。修正了一条写错的断言（光标在 `@` 词中间按截断 query 触发是预期行为）。
- `webview-ui/Composer.tsx` 改造：
  - `mentionSuppressed` 布尔 → `suppressedAt`（被 Esc 抑制的 `@` 下标）+ 新增 `caret`/`composing` state；`mentionOpen` 渲染期由 `mentionTail(text, caret)` 重算，光标移走即关。
  - 无匹配即关弹层：两个弹层渲染门控 `rows > 0`，删除 `noMatchingFiles`/`noMatchingCommands` 空态渲染（i18n key 保留未删）。
  - `acceptActive()` 空列表返回 false，Enter 不再被吞（列表空 → preventDefault 后落到 `shouldSend` → 发送）。
  - Esc 抑制存续到该 `@` 被删除（`handleChange` 检测 `value[suppressedAt] !== "@"` 自动解除）或出现新 `@`（下标不同）。
  - IME：`onCompositionStart/End` + `composing` state，组合期间不触发请求/不重置抑制，compositionend 统一评估。
  - `acceptMention` 改按 `atIndex..caret` 精确切除 `@query`（原全文尾部正则替换）。
- typecheck / lint / 232 测试全绿。

