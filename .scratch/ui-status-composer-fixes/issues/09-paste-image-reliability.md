# 09 图片粘贴需多次尝试

Status: resolved
Type: task

按 spec 分支 9 实施。验收：paste 监听上提 webview window/document 级（焦点不在输入框可粘贴）；`imageStaged` 未消费不丢弃（保留至被 chip 消费或超时清理）。

## Comments

### 2026-11-17

- `Composer.tsx`：图片 paste 处理上提 webview `document` 级 `useEffect`（命中图片项即 preventDefault + `stageImageFile`）；textarea 的 `onPaste` 只保留裸 URL→链接 token 的文本逻辑（事件仍冒泡到 document，行为不重复不丢失）。新增 `chipsRef` 实时镜像供监听闭包使用（MAX_IMAGES 判额不读过期 state）；`stageImageFile` 改用 chipsRef。
- `app.tsx`：`stagedImages` 消费改为"未消费不标记"——`composerHandleRef` 未就绪时不标记，重试 interval（1s）每秒重投；首次见到即记时间戳，30s 未消费则放弃并标记（超时清理）。宿主侧 staged 内存仍由发送/丢弃路径清理（panel.ts :590/:650），不变。
- typecheck / lint / 233 测试全绿。

