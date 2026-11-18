# 01 实证服务器 snapshot.files 归因边界

Status: ready-for-agent
Type: research

按 spec「待证事实」1-4 设计受控实验并产出 Answer:

- 自建 server:`opencode serve --port <p>`,以已知密码环境变量直连(勿试图观测扩展私有 server,见 spec 已知事实)。
- 建议序列:会话 A 让 agent 新建文件 → 读取 A 的 assistant 消息 `snapshot.files` 基线 → 会话 B 跑一个**不碰该文件**的回合(纯聊天即可) → 分别读取 B 的 assistant `snapshot.files` 与 `GET /api/session/{id}/diff`(带与不带 `from/to`) → 记录 B 是否含 A 的文件及其状态/计数。
- 变体覆盖待证 4:父会话跑一个会 spawn subagent 改文件的回合,读父/子消息的 `snapshot.files`。
- 每步记录请求与响应原文;结论按待证 1-4 逐条作答;无法观测的项如实标注阻塞与原因。
