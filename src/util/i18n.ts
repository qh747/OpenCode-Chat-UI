/**
 * User-facing copy in English and Simplified Chinese. The locale follows the
 * VS Code display language: the host resolves `vscode.env.language` once at
 * activation, each webview from the `locale` its host sends with the first
 * message. `zh-hans` counts as Simplified; other `zh` variants (zh-tw, zh-hant)
 * fall back to English until a Traditional dictionary exists.
 */
export type Locale = "en" | "zh-cn";

const en = {
  // connection / shared
  retry: "Retry",
  showLogs: "Show logs",
  startingServer: "Starting opencode server…",
  serverNotRunning: "opencode server is not running.",
  serverNotConnected: "server not connected",
  serverNotConnectedYet: "OpenCode server is not connected yet.",
  shellWriteNoServer: "The opencode server is not connected.",
  noConfigFileYet: "No config file yet — it is created when you change a setting.",
  noWorkspace: "OpenCode: open a workspace folder first.",
  cliNotFound:
    'opencode CLI not found. Install it (https://opencode.ai/docs) or set "opencode.path".',

  // header / session surfaces
  newSession: "New session",
  settingsTitle: "Settings",
  serverConfigEntry: "Server configuration",
  historyTitle: "Session history",
  noSessions: "No sessions yet",
  untitled: "Untitled",
  renameTitle: "Rename",
  forkTitle: "Fork",
  exportMdTitle: "Export as Markdown",
  deleteTitle: "Delete",
  agentPickerTitle: "Agent (Shift+Tab cycles)",
  effortPickerTitle: "Reasoning effort",
  effortDefault: "Default",
  modelFallback: "Model",
  searchModels: "Search models",
  noMatchingModels: "No matching models",
  freeBadge: "Free",

  // permission card
  permissionRequired: "Permission required",
  allowOnce: "Allow once",
  alwaysAllow: "Always allow",
  deny: "Deny",

  // question card (the `question` tool)
  questionTitle: "Questions",
  questionSubmit: "Submit",
  questionSkip: "Dismiss",
  questionSkipTitle: "Dismiss and let the model continue without answers",
  questionCustomPlaceholder: "Or type your own answer…",
  questionMultiHint: "Multiple choices allowed",

  // diff card
  diffExpand: "Show changed files",
  diffCollapse: "Hide changed files",
  changesCount: "Changes {count}",
  revertFileTitle: "Revert this file to its previous state",
  revertConflict: "OpenCode: the file changed after this session's edit — revert skipped.",
  "diffStatus.modified": "modified",
  "diffStatus.added": "added",
  "diffStatus.deleted": "deleted",

  // welcome
  welcomePrompt: "What should we work on?",

  // transcript
  "toolVerb.bash": "Ran command",
  "toolVerb.read": "Read",
  "toolVerb.write": "Wrote",
  "toolVerb.edit": "Edited",
  "toolVerb.grep": "Searched",
  "toolVerb.glob": "Searched",
  "toolVerb.list": "Listed",
  "toolVerb.webfetch": "Fetched",
  "toolVerb.task": "Task",
  "toolVerb.todos": "Todos",
  "toolVerb.question": "Asked",
  thinking: "Thinking",
  thoughtFor: "Thought for {count}s",

  // attachments
  attachmentsCount: "{count} attachments",
  attachmentSummaryLine: "{count} attachments · {summary}",
  clearAll: "Clear all",
  removeAttachment: "Remove attachment",
  closePreview: "Close (Esc)",
  rewindTitle:
    "Rewind to before this message (removes later messages, reverts their file changes)",
  "kindWord.image": "Image",
  "kindWord.file": "File",
  "kindWord.selection": "Selection",
  "kindWord.url": "Link",

  // composer
  composerPlaceholder: "Ask anything · / for commands · @ for context...",
  composerPlaceholderBusy: "Model is working · Enter to queue · Esc to stop",
  attachFilesTitle: "Attach files",
  sendTitle: "Send (Enter)",
  stopTitle: "Stop (Esc)",
  maxImages: "Maximum {count} images per message.",
  chipHintImage: "Click to preview · sent as inline data URI",
  chipHintUrl: "Ctrl+click to open in browser · click to preview link",
  chipHintFile: "Ctrl+click to open in editor{range} · click to preview",
  noMatchingCommands: "No matching commands or skills",
  noMatchingFiles: "No matching files",
  sessionInfoTitle: "Session info",
  openSourceControlTitle: "Open Source Control",
  revealInExplorerTitle: "Reveal in Explorer",
  closeTitle: "Close",
  exportSession: "Export session",
  statSession: "Session",
  statProvider: "Provider",
  statModel: "Model",
  statContextLimit: "Context limit",
  statTotalTokens: "Total tokens",
  statUsage: "Usage",
  statInputTokens: "Input tokens",
  statOutputTokens: "Output tokens",
  statReasoningTokens: "Reasoning tokens",
  statCacheTokens: "Cache tokens (read/write)",
  statMessages: "Messages",
  statUserMessages: "User messages",
  statAssistantMessages: "Assistant messages",
  statCost: "Total cost",
  statCreated: "Created",
  statUpdated: "Last activity",
  systemPrompt: "System prompt",
  rawMessages: "Raw messages",
  mentionGroupSelected: "Active editor · selected",
  mentionGroupOpen: "Open · no selection",
  mentionGroupOther: "Files",
  commandGroupSkills: "Skills",
  mentionSelectedHint: "{range} · selected",
  "builtin.new": "New session",
  "builtin.undo": "Undo last message",
  "builtin.compact": "Summarize the session to shrink context",
  "builtin.fork": "Fork from an earlier message",
  "builtin.export": "Export the transcript as Markdown",

  // attachment preview
  urlPreviewNote: "The link travels as text and is fetched by the server.",
  reading: "Reading…",
  previewFailed: "Cannot preview: {error}",
  previewEmpty: "Nothing to preview for this attachment.",
  "previewNote.url": "Ctrl+click to open in browser",
  "previewNote.image": "Sent as inline data URI",
  "previewNote.file": "Ctrl+click to open in editor",

  // queue strip
  queueExpand: "Show queue",
  queueCollapse: "Hide queue",
  queueCount: "Queue {count}",
  queuePausedNote: "Paused · resumes when you continue",
  resume: "Resume",
  sendNow: "Send now",
  removeFromQueue: "Remove from queue",

  // subagent strip
  subagentCount: "Subagent {count}",
  subagentStopTitle: "Stop this subagent",
  subagentOpenTitle: "Open subagent session",
  backToParent: "Back to parent session",

  // markdown code block
  copy: "copy",
  copied: "copied",

  // context bar
  noGit: "no git",
  noDir: "no dir",
  branchDirTitle: "Branch of the agent's working directory",
  contextTokensTitle: "Context tokens used",
  cacheHitRateTitle: "Cache hit rate",

  // host notices and flows
  turnFailed: "OpenCode: the turn failed.",
  turnCompleteNamed: "OpenCode: {title} finished.",
  turnComplete: "OpenCode: turn finished.",
  permissionNotice: "OpenCode: a permission request needs your approval.",
  questionNotice: "OpenCode: the model is asking you a question.",
  errorNotice: "OpenCode: {message}",
  selectionTooLong: "(selection too long to auto-attach)",
  rewindConfirm:
    "Rewind to before this message? Later messages are removed and their file changes are reverted.",
  rewindButton: "Rewind",
  nothingToUndo: "Nothing to undo yet.",
  sessionNamePrompt: "Session name",
  deleteSessionConfirm: "Delete this session?",
  deleteButton: "Delete",
  exportedTo: "Session exported to {path}",
  attachFilesPicker: "Attach files as context",

  // history grouping and relative time
  "group.today": "Today",
  "group.yesterday": "Yesterday",
  "group.week": "Last 7 days",
  "group.month": "Last 30 days",
  "group.older": "Earlier",
  "time.justNow": "just now",
  "time.minutesAgo": "{count}m ago",
  "time.hoursAgo": "{count}h ago",
  "time.daysAgo": "{count}d ago",

  // server config panel
  serverPanelTitle: "OpenCode Server Configuration",
  serverConfigGroup: "Server configuration",
  scopeGlobal: "Global",
  scopeProject: "Project",
  newFileHint: "(new file)",
  openConfigFile: "Open config file",
  externalServerWarn:
    "The server runs elsewhere and reads its own config files — these edits apply to this machine only.",
  notSetWithDefault: "not set (server default: {default})",
  savedMarker: "saved",
  resetToDefault: "Restore the default",
  resetLabel: "reset",
  notSetPlaceholder: "Not set",
  serverDefaultPlaceholder: "Server default",
  onePerLine: "One path or URL per line",

  // server setting items
  "settings.model.label": "Default model",
  "settings.model.hint":
    "Applies to new sessions. A session that already picked a model keeps it.",
  "settings.default_agent.label": "Default agent",
  "settings.default_agent.hint": "Applies to new sessions.",
  "settings.compaction.auto.label": "Compact the context automatically",
  "settings.compaction.keep.tokens.label": "Tokens kept after compaction",
  "settings.tool_output.max_lines.label": "Tool output line limit",
  "settings.media.image.max_base64_bytes.label": "Image size limit (bytes)",
  "settings.snapshots.label": "File snapshots (undo / revert)",
  "settings.formatter.label": "Format files after editing",
  "settings.instructions.label": "Extra instruction files",
  "settings.instructions.hint": "One path or URL per line.",
  "settings.shell.label": "Terminal shell",
  "settings.shell.hint": "The server writes this key into its global config only.",

  // transcript history
  historyLoading: "Loading earlier messages…",
  historyStart: "Start of conversation",
};

const zhCn: Record<MessageKey, string> = {
  // connection / shared
  retry: "重试",
  showLogs: "查看日志",
  startingServer: "正在启动 opencode server…",
  serverNotRunning: "opencode server 未运行。",
  serverNotConnected: "server 未连接",
  serverNotConnectedYet: "OpenCode server 尚未连接。",
  shellWriteNoServer: "opencode server 未连接。",
  noConfigFileYet: "还没有配置文件——修改任一设置时才会创建。",
  noWorkspace: "OpenCode：请先打开一个工作区文件夹。",
  cliNotFound: "未找到 opencode CLI。请安装（https://opencode.ai/docs）或设置 \"opencode.path\"。",

  // header / session surfaces
  newSession: "新会话",
  settingsTitle: "设置",
  serverConfigEntry: "服务器配置",
  historyTitle: "会话历史",
  noSessions: "还没有会话",
  untitled: "未命名",
  renameTitle: "重命名",
  forkTitle: "派生",
  exportMdTitle: "导出为 Markdown",
  deleteTitle: "删除",
  agentPickerTitle: "Agent（Shift+Tab 循环切换）",
  effortPickerTitle: "推理强度",
  effortDefault: "默认",
  modelFallback: "模型",
  searchModels: "搜索模型",
  noMatchingModels: "没有匹配的模型",
  freeBadge: "免费",

  // permission card
  permissionRequired: "需要权限",
  allowOnce: "本次允许",
  alwaysAllow: "总是允许",
  deny: "拒绝",

  // question card（`question` 工具）
  questionTitle: "提问",
  questionSubmit: "提交",
  questionSkip: "跳过",
  questionSkipTitle: "跳过提问，让模型在没有回答的情况下继续",
  questionCustomPlaceholder: "或输入自定义回答…",
  questionMultiHint: "可多选",

  // diff card
  diffExpand: "展开已修改文件",
  diffCollapse: "收起已修改文件",
  changesCount: "改动 {count}",
  revertFileTitle: "将此文件还原为修改前的状态",
  revertConflict: "OpenCode：文件在本会话改动之后又被修改过，已跳过还原。",
  "diffStatus.modified": "修改",
  "diffStatus.added": "新增",
  "diffStatus.deleted": "删除",

  // welcome
  welcomePrompt: "想做点什么？",

  // transcript
  "toolVerb.bash": "运行命令",
  "toolVerb.read": "读取",
  "toolVerb.write": "写入",
  "toolVerb.edit": "编辑",
  "toolVerb.grep": "搜索",
  "toolVerb.glob": "搜索",
  "toolVerb.list": "列出",
  "toolVerb.webfetch": "抓取",
  "toolVerb.task": "任务",
  "toolVerb.todos": "待办",
  "toolVerb.question": "提问",
  thinking: "思考中",
  thoughtFor: "思考 {count} 秒",

  // attachments
  attachmentsCount: "附件 {count}",
  attachmentSummaryLine: "{count} 个附件 · {summary}",
  clearAll: "全部清除",
  removeAttachment: "移除附件",
  closePreview: "关闭 (Esc)",
  rewindTitle: "回退到此消息之前（移除其后的消息，并还原相应文件改动）",
  "kindWord.image": "图片",
  "kindWord.file": "文件",
  "kindWord.selection": "选区",
  "kindWord.url": "链接",

  // composer
  composerPlaceholder: "随便问点什么， / 可查看命令， @ 可添加上下文...",
  composerPlaceholderBusy: "模型处理中 · Enter 加入队列 · Esc 停止",
  attachFilesTitle: "附加文件",
  sendTitle: "发送 (Enter)",
  stopTitle: "停止执行 (Esc)",
  maxImages: "每条消息最多 {count} 张图片。",
  chipHintImage: "单击 预览图片 · 发送时以 inline data URI 传递",
  chipHintUrl: "Ctrl+单击 在浏览器中打开 · 单击 预览链接",
  chipHintFile: "Ctrl+单击 在编辑器中打开{range} · 单击 预览",
  noMatchingCommands: "没有匹配的命令或技能",
  noMatchingFiles: "没有匹配的文件",
  sessionInfoTitle: "会话信息",
  openSourceControlTitle: "打开源代码管理",
  revealInExplorerTitle: "在资源管理器中显示",
  closeTitle: "关闭",
  exportSession: "导出会话",
  statSession: "会话",
  statProvider: "提供商",
  statModel: "模型",
  statContextLimit: "上下文限制",
  statTotalTokens: "词元总数",
  statUsage: "使用率",
  statInputTokens: "输入词元",
  statOutputTokens: "输出词元",
  statReasoningTokens: "推理词元",
  statCacheTokens: "缓存词元 (读/写)",
  statMessages: "消息数",
  statUserMessages: "用户消息",
  statAssistantMessages: "助手消息",
  statCost: "总成本",
  statCreated: "创建时间",
  statUpdated: "最后活动",
  systemPrompt: "系统提示词",
  rawMessages: "原始消息",
  mentionGroupSelected: "当前编辑器 · 已选中",
  mentionGroupOpen: "已打开 · 无选区",
  mentionGroupOther: "文件",
  commandGroupSkills: "技能",
  mentionSelectedHint: "{range} · 已选中",
  "builtin.new": "新会话",
  "builtin.undo": "撤销上一条消息",
  "builtin.compact": "总结会话以减少上下文大小",
  "builtin.fork": "从之前的消息创建新会话",
  "builtin.export": "将完整会话记录导出为 Markdown",

  // attachment preview
  urlPreviewNote: "发送时以文本形式附加这个链接，由服务端取回内容。",
  reading: "读取中…",
  previewFailed: "无法预览：{error}",
  previewEmpty: "这个附件没有可预览的内容。",
  "previewNote.url": "Ctrl+单击 在浏览器中打开",
  "previewNote.image": "发送时以 inline data URI 传递",
  "previewNote.file": "Ctrl+单击 在编辑器中打开",

  // queue strip
  queueExpand: "展开队列",
  queueCollapse: "收起队列",
  queueCount: "队列 {count}",
  queuePausedNote: "已暂停 · 继续后自动发送",
  resume: "继续",
  sendNow: "立即发送",
  removeFromQueue: "从队列中删除",

  // subagent strip
  subagentCount: "子代理 {count}",
  subagentStopTitle: "停止这个子代理",
  subagentOpenTitle: "查看子代理会话",
  backToParent: "返回上一级会话",

  // markdown code block
  copy: "复制",
  copied: "已复制",

  // context bar
  noGit: "无 git",
  noDir: "无工作区",
  branchDirTitle: "agent 工作目录的分支",
  contextTokensTitle: "已用上下文 token",
  cacheHitRateTitle: "缓存命中率",

  // host notices and flows
  turnFailed: "OpenCode：本轮执行失败。",
  turnCompleteNamed: "OpenCode：{title} 已完成。",
  turnComplete: "OpenCode：本轮已完成。",
  permissionNotice: "OpenCode：有权限请求等待你的批准。",
  questionNotice: "OpenCode：模型正在向你提问。",
  errorNotice: "OpenCode：{message}",
  selectionTooLong: "（选区过长，未自动附加）",
  rewindConfirm: "回退到此消息之前？其后的消息将被移除，相应文件改动会被还原。",
  rewindButton: "回退",
  nothingToUndo: "还没有可撤销的消息。",
  sessionNamePrompt: "会话名称",
  deleteSessionConfirm: "删除此会话？",
  deleteButton: "删除",
  exportedTo: "会话已导出到 {path}",
  attachFilesPicker: "选择要附加为上下文的文件",

  // history grouping and relative time
  "group.today": "今天",
  "group.yesterday": "昨天",
  "group.week": "最近 7 天",
  "group.month": "最近 30 天",
  "group.older": "更早",
  "time.justNow": "刚刚",
  "time.minutesAgo": "{count} 分钟前",
  "time.hoursAgo": "{count} 小时前",
  "time.daysAgo": "{count} 天前",

  // server config panel
  serverPanelTitle: "OpenCode 服务器配置",
  serverConfigGroup: "服务器配置",
  scopeGlobal: "全局",
  scopeProject: "项目",
  newFileHint: "（新文件）",
  openConfigFile: "打开配置文件",
  externalServerWarn:
    "服务器在别处运行并读取它自己的配置文件——这里的修改只作用于本机。",
  notSetWithDefault: "未设置（服务器默认：{default}）",
  savedMarker: "已保存",
  resetToDefault: "恢复默认值",
  resetLabel: "重置",
  notSetPlaceholder: "未设置",
  serverDefaultPlaceholder: "服务器默认",
  onePerLine: "每行一个路径或 URL",

  // server setting items
  "settings.model.label": "默认模型",
  "settings.model.hint": "对新建会话生效。已选择模型的会话保持不变。",
  "settings.default_agent.label": "默认 Agent",
  "settings.default_agent.hint": "对新建会话生效。",
  "settings.compaction.auto.label": "自动压缩上下文",
  "settings.compaction.keep.tokens.label": "压缩后保留的 token 数",
  "settings.tool_output.max_lines.label": "工具输出行数上限",
  "settings.media.image.max_base64_bytes.label": "图片大小上限（字节）",
  "settings.snapshots.label": "文件快照（撤销 / 还原）",
  "settings.formatter.label": "编辑后格式化文件",
  "settings.instructions.label": "额外的指令文件",
  "settings.instructions.hint": "每行一个路径或 URL。",
  "settings.shell.label": "终端 shell",
  "settings.shell.hint": "该键只会写入服务器的全局配置。",

  // transcript history
  historyLoading: "正在加载更早的消息…",
  historyStart: "已到会话开头",
};

/** All copy, per locale. `en` owns the canonical key set. */
export const messages: Record<Locale, Record<MessageKey, string>> = {
  en,
  "zh-cn": zhCn,
};

export type MessageKey = keyof typeof en;

/** Which dictionary a display language uses. */
export function resolveLocale(language: string): Locale {
  const normalized = language.trim().toLowerCase();
  if (normalized === "zh" || normalized.startsWith("zh-hans") || normalized === "zh-cn") {
    return "zh-cn";
  }
  return "en";
}

let current: Locale = "en";

/** Set the locale for this process (extension host or webview). */
export function setLocale(locale: Locale): void {
  current = locale;
}

/** The locale set for this process. */
export function getLocale(): Locale {
  return current;
}

/** Look up a string in an explicit locale, interpolating `{vars}`. */
export function translate(
  locale: Locale,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const text = messages[locale][key] ?? messages.en[key] ?? key;
  if (!vars) {
    return text;
  }
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

/** Look up a string in this process's locale, interpolating `{vars}`. */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  return translate(current, key, vars);
}
