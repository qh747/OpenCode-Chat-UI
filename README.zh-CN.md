# OpenCode for VS Code

[English](README.md) | 简体中文

一个 [VS Code](https://code.visualstudio.com) 扩展，为你的本地 [opencode](https://opencode.ai) CLI 提供 CommandCode 风格的聊天体验——直接复用你已有的登录态，包括 **OpenCode Go 订阅**。

> 社区集成作品，非 opencode 官方产品。CommandCode 是闭源商业产品、绑定其自有订阅；本扩展让你在自己的 opencode 上获得类似的 IDE 体验。

## 功能

- **聊天面板**（默认在辅助侧边栏，可随意拖动）：流式回复、Markdown 渲染、思考过程与工具调用卡片可折叠展开。
- **会话树**：按日期分组，支持打开 / 重命名 / 删除。
- **原生 Diff**：代码修改直接用 VS Code 的 diff 编辑器查看，支持按文件「保留 / 回滚」。
- **权限卡片**：Allow once / Always allow / Deny，基于 opencode 的权限 API。
- **模型与模式选择器**：opencode 里配置的所有 provider（包括 `opencode-go/*` 订阅模型）+ 原生 agent（build / plan / 自定义 agent），`Shift+Tab` 循环切换。
- **上下文**：`@` 模糊搜索附加文件，`+` 多选文件，自动附加当前编辑器的选区。
- **Plan 衔接**：plan 模式探索完后，一键切换 build 模式并执行计划。
- **零账号处理**——扩展为每个窗口启动一个私有的 `opencode serve`（随机端口 + 随机密码，随窗口关闭而结束），或连接已有 server；认证完全留在你的 opencode CLI 登录态里。

## 环境要求

- 已安装并登录 [opencode CLI](https://opencode.ai/docs) v2.x（`opencode auth login`）。Windows 上如果 PATH 里没有 CLI，扩展会自动回退到 OpenCode 桌面应用内置的 CLI。
- VS Code 1.106+。

## 快速开始

1. 安装 VSIX：`code --install-extension opencode-vscode-0.1.0.vsix`（或在本仓库按 F5）。
2. 打开一个工作区文件夹，扩展会为它启动 opencode server。
3. 点击活动栏（下方图标区）的 OpenCode 图标，开始对话。

## 设置

| 设置项 | 默认值 | 说明 |
| --- | --- | --- |
| `opencode.path` | `""` | 手动指定 opencode 二进制路径（否则自动探测）。 |
| `opencode.serverUrl` | `""` | 连接已运行的 opencode v2 server，而不是每个窗口启动一个。 |
| `opencode.serverPassword` | `""` | 外部 server 的密码（Basic auth 用户固定为 `opencode`）。 |
| `opencode.context.autoAttachSelection` | `true` | 发送消息时自动附加当前编辑器的选区。 |
| `opencode.context.maxSelectionLength` | `2000` | 选区附加的最大字符数。 |

## 快捷键

| 按键 | 动作 |
| --- | --- |
| `Ctrl/Cmd+Shift+'` | 聚焦聊天面板 |
| `Shift+Tab`（输入框内） | 循环切换 agent 模式 |
| `Enter` / `Shift+Enter` | 发送 / 换行 |

## 开发

```bash
npm install
npm run compile      # 构建扩展 + webview
npm run watch        # 监听重编译
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # 单元测试（node:test）
npm run package      # vsce 打包
```

在本仓库按 **F5**（运行 → 启动调试）即可启动加载了扩展的开发宿主。

本扩展使用的 v2 HTTP API 已对照 opencode 2.2.7 自带的 OpenAPI 文档（server 上的 `GET /openapi.json`）逐一验证；快照保留在 `dev/openapi.json` 作参考。

## 路线图（v2）

- 图片附件（粘贴 / 拖拽，最多 6 张）
- 会话 fork / rewind（消息级回滚）/ 记录导出
- 推理力度（reasoning effort）选择
- 四档权限预设（自动接受编辑 / 完全访问）
- 终端 CLI 桥接（`/ide` 风格）

## 提示：按量通道与订阅

opencode 的默认模型可能落在 `opencode` 按量付费通道——如果该通道余额为 0，对话会立刻报 402 "Insufficient balance"。你的订阅模型在 `opencode-go` provider 下，从模型选择器里选 `opencode-go/*` 即可使用订阅额度。

## 许可

[MIT](LICENSE)
