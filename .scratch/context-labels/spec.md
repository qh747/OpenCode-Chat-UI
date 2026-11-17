# 闭合态标签：模型名与工作区目录

Status: implemented

## Question

两个标签在"选中之后"仍然携带多余身份：

- 模型选择器的闭合态显示 `OpenCode Go /DeepSeek V4.1 Flash 1017` —— 套餐名常驻，
  而套餐只在挑模型的那一刻有意义；
- 上下文条把工作区绝对路径整段铺开（`/home/quhan/01_myProject/opencode-plugin`），
  在窄栏里吃掉半行，真正需要的只是"是哪个目录"。

它们应该显示什么？

## Prototype

`prototype/labels/` —— 四个变体，`npm run prototype:labels` 构建，
`?variant=baseline|A|B|C` 或底部浮动条切换（带宽度滑杆、无工作区开关、中英切换）。

- **baseline · 现状** —— `OpenCode Go /DeepSeek V4.1 Flash 1017` + 绝对路径。
- **A · 只留名字** —— 模型名单独显示；路径只留最后一级目录；无工作区显示 `无工作区`。
- **B · 淡提示** —— 模型名 + 灰色 `· Go` 后缀；路径 `…/opencode-plugin`。
- **C · 路径按钮** —— 模型名 + 套餐色点；路径做成文件夹图标 chip。

选择窗在四个变体里完全一致：`RECENT / OPENCODE GO / OPENCODE` 分组与每行的
`OpenCode Go` 徽标都保留。

## Verdict

**A**，并顺手去掉 git 分支前的 `⎇` 图标。

面板是窄栏，闭合标签的职责是"我现在用的是哪个模型 / 哪个目录"，不是"它属于
哪个套餐 / 它的父路径是什么"。套餐信息在选择窗里有分组标题和每行徽标，打开
一次就能看到，不需要常驻；完整路径留在 tooltip 里，点击 reveal 的行为不变。
B 和 C 都在闭合态里给身份留了第二种编码（文字后缀 / 颜色 / chip），在 12px 的
按钮和 10px 的上下文条里都是噪声。

`⎇` 只是装饰：分支段本来就带 "Open Source Control" 的 title 且可点击，图标
不传递额外信息。

无工作区时路径段不再整段消失，显示 `no dir` / `无工作区`（tooltip 复用已有的
`noWorkspace` 文案），这样输入框下面永远是自解释的。

顺带确认的行为：面板 ≤350px 时走既有的容器查询阶梯，闭合标签本就降级成
`modelShortName()`（`DeepSeek V4.1`），所以窄栏下"去套餐"的收益主要出现在
350–500px 这一段。

## What was implemented

- `webview-ui/ModelPicker.tsx` —— 闭合按钮只渲染 `displayName`；`label-short`
  降级不变；菜单未动。
- `webview-ui/ContextBar.tsx` —— 分支文案去掉 `⎇`；路径用 `folderName()` 取最后
  一段、tooltip 保留完整路径；无工作区渲染 `noDir`；strip 不再因"没有内容"而
  返回 null。
- `src/util/i18n.ts` —— 新增 `noDir`（`no dir` / `无工作区`）。
- `webview-ui/styles.css` —— `.ctx-nodir` 的弱化样式。
- `test/context-bar.test.ts` —— 分支文案、目录名、tooltip、无工作区、
  `folderName` 的 Unix/Windows/尾分隔符用例。
- `test/model-picker.test.ts` —— 闭合标签不含套餐名；目录未加载时回落到模型 id。

## Open

原型按仓库惯例应提交到 throwaway 分支留存，本次未做（未获提交授权）；
`prototype/` 被 gitignore，工作区里的副本仍在。`npm test` 在本机 Node 18 下
因 jsdom 31 的 ESM 依赖启动失败（仓库 engines 指向 Node 20+，环境问题，与本次
改动无关）；新增的两个测试文件单独打包运行均通过。
