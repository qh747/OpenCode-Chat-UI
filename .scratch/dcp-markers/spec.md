# DCP message markers in replies

Status: implemented

## Question

有些回合结束时，助手回复的末尾会多出一个 `@14@` / `@16@`。是扩展渲染错了，
还是模型真的输出了它？要不要显示？

## Answer

**不是扩展的 bug。** 那是 `@tarquinen/opencode-dcp` 插件给会话里每条消息打的
id 标记 —— 该插件的 compact 格式就是 `` `@${index}@` ``（压缩块是 `@b1@`，
还允许带优先级标签 `@7@ [high]`；另一种格式是
`<dcp-message-id>m0007</dcp-message-id>`）。标记是给模型用的：让模型能在
后续回合里引用某条消息。模型偶尔会把这个标记回显到自己回复的末尾。

插件源码在 `~/.cache/opencode/npm/@tarquinen/opencode-dcp@latest/<hash>/node_modules/@tarquinen/opencode-dcp/dist/index.js`，
`format === "compact"` 分支。

## What was implemented

`src/util/dcp-markers.ts` 的 `stripTrailingMarkers()`：在**渲染层**把文本
**末尾**独占一行的标记剥掉，支持 compact 与 XML 两种形式。中间出现的标记
**不剥** —— 在那里它可能是模型对另一条消息的真实引用，正是插件打标的目的。
紧贴在上一行文字后面的标记也不剥（`列表项 @14@` 可能是正当内容），只处理
独占一行的情况，零误伤。

`webview-ui/MessageList.tsx` 的 text part 渲染处调用它；剥完为空就不渲染。

流式过程中的半截标记（`@1`）不匹配完整正则，所以会短暂显示、到齐后消失，
与 Markdown 流式渲染的既有行为一致。

## Open

XML 形式 `<dcp-message-id>…</dcp-message-id>` 若出现在正文中段，DOMPurify
会剥掉未知标签、留下里面的 `m0014` 文本。没在真实会话里遇到，暂不处理。
