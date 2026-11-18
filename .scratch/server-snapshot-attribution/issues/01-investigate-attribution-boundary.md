# 01 实证服务器 snapshot.files 归因边界

Status: resolved
Type: research

按 spec「待证事实」1-4 设计受控实验并产出 Answer:

- 自建 server:`opencode serve --port <p>`,以已知密码环境变量直连(勿试图观测扩展私有 server,见 spec 已知事实)。
- 建议序列:会话 A 让 agent 新建文件 → 读取 A 的 assistant 消息 `snapshot.files` 基线 → 会话 B 跑一个**不碰该文件**的回合(纯聊天即可) → 分别读取 B 的 assistant `snapshot.files` 与 `GET /api/session/{id}/diff`(带与不带 `from/to`) → 记录 B 是否含 A 的文件及其状态/计数。
- 变体覆盖待证 4:父会话跑一个会 spawn subagent 改文件的回合,读父/子消息的 `snapshot.files`。
- 每步记录请求与响应原文;结论按待证 1-4 逐条作答;无法观测的项如实标注阻塞与原因。

## Answer(2026-11-19,自建 server 实证)

### 实验设置

- 自建 server:`opencode serve --port 27533 --hostname 127.0.0.1`,env `OPENCODE_PASSWORD=OPENCODE_SERVER_PASSWORD=attrlab-pw-2026`,v2.3.0,Basic 认证直连,cwd = 专用实验目录 `/tmp/opencode/attr-lab2`(独立 git init 的空仓;非本仓、非用户项目)。
- 模型:`opencode-go/glm-5.3-flash`(该机器唯一已认证 provider 下的 tool-capable 模型;`/api/model` 实测 34 个)。权限泵轮询 `GET /api/permission/request?location[directory]=…` 并对每个请求回 `decision:"once"`(本实验未触发任何权限请求,write 直接过)。
- 驱动:`/tmp/opencode/attr-driver.mjs`(node fetch;SSE `/api/event` 监听;结果与逐事件 journal 在 `/tmp/opencode/attr-results/`,**临时工件,随时可删**)。journal 内 `EXTVIEW` 行是按扩展 0.4.21+ 精确逻辑(`attributionSet` + 严格过滤)对每步 diff 的重放。
- 回合完成检测:v2.3.0 实测 **`session.idle` 事件 12 个回合 0 次出现**,回合结束只有 `session.execution.succeeded`。扩展两种都监听(`panel.ts:1288-1291`),无影响,但单靠 idle 等待会挂死(我第一次驱动即如此)。
- 旁证:`GET /api/session/{id}/message` 返回**新→旧**排序(与 `src/util/messages.ts` 的 orderMessages 注释一致);快照 ID 是**内容寻址的 git tree hash**(`4b825dc642cb6eb9a060e54bf8d69288fbee4904` = git 空树哈希,同内容树跨会话共享同一 ID)。

### 机制结论(一句话)

`snapshot.files` **不是"本会话 agent 碰过什么"的记录,而是该 assistant 消息自带的 [snapshot.start → snapshot.end] 窗口内共享工作树的内容差**——窗口内任何来源的改动(其他会话的回合、扩展直接写盘、用户手工编辑)都会被算进这条消息的 `files`,与该回合是否调用过任何工具无关。OpenAPI 对 diff 端点的描述与此一致(原文):

> "Structured per-file diffs of the files a turn changed. A turn runs from the first prompt after the session was last idle until its next idle marker … Compares the range's first recorded snapshot with its last; a step still running in the active session compares against the working copy."

### 待证 1:B 的 snapshot.files 是否含 B 未碰过、他人改过的文件?——**是**(两种方向都实证)

**方向一:另一会话的写入落进 B 的纯聊天回合窗口(exp4)。** 先让 A 写 `a.md`(内容 `base`);随后**先发 A 的改写回合,800ms 后再发 B 的纯聊天回合**,使 A 的 write 落在 B 的回合窗口内。B 的 assistant 消息原文(`"tools":[]` ——B 的 agent 一个工具都没调):

```json
{"type":"assistant","id":"msg_1ef748235001IXh8z2yJzQD53S","time":{"created":1795018752569,"firstToken":1795018755462,"streamed":1795018759251,"completed":1795018759261},"finish":"stop","agent":"build","model":{"providerID":"opencode-go","id":"glm-5.3-flash"},"snapshot":{"start":"f359e7019624bf29e2fe1dc058272bf49dde40c5","end":"48e718ddccb54d987aa29796faad653964d18f1e","files":["a.md"]},"tools":[]}
```

真正写文件的 A6 消息原文(注意 **start/end 与 B 那条完全相同** ——同一棵树的内容哈希,跨会话共享):

```json
{"type":"assistant","id":"msg_1ef747f0b001f52LguQtIO5kAr","time":{"created":1795018751758,"firstToken":1795018753120,"streamed":1795018753186,"completed":1795018753211},"finish":"tool-calls","agent":"build","model":{"providerID":"opencode-go","id":"glm-5.3-flash"},"snapshot":{"start":"f359e7019624bf29e2fe1dc058272bf49dde40c5","end":"48e718ddccb54d987aa29796faad653964d18f1e","files":["a.md"]},"tools":[{"name":"write","status":"completed","input":{"content":"changed-by-A-during-B\n","path":"a.md"}}]}
```

时间线:B 的 user 消息 created 1795018752560 → A 的 write 完成 1795018753211 → B 的回合完成 1795018759261,写入确实在 B 窗口内。`GET /api/session/{B}/diff`(不带参数,即 B 最新 user 回合)响应原文:`modified a.md +1 -1`;EXTVIEW 重放:`attribution=["a.md"] rawRows=["modified a.md +1 -1"] keptAfterFilter=["modified a.md +1 -1"]` ——**0.4.21+ 严格过滤挡不住,B 的列表会显示 A 的改动**。这就是 Q11("B 跑过回合仍串行")的复现路径。

**方向二:无会话的外部删除落进 B 的纯聊天回合窗口(exp3 phase 3)。** a.md 由 A 写好后,B 发纯聊天回合("回一首 40 词的诗,不要用工具"),2.5s 后在驱动里直接 `unlink a.md`(模拟扩展 revertFile 写盘 / 用户编辑,不产生任何 server 回合)。删除时刻 16:07:32.145 落在 B 该消息的 firstToken(…531.570)与 completed(…532.485)之间。B 的 assistant 消息原文:

```json
{"type":"assistant","id":"msg_1ef69c875001Ky5dINJB9dhnMD","time":{"created":1795018049656,"firstToken":1795018051570,"streamed":1795018052459,"completed":1795018052485},"finish":"stop","agent":"build","model":{"providerID":"opencode-go","id":"glm-5.3-flash"},"snapshot":{"start":"f65fe7e9aada48d950be8931a9f2076ff0d265c3","end":"4b825dc642cb6eb9a060e54bf8d69288fbee4904","files":["a.md"]},"tools":[]}
```

start = 含 a.md 的树(回合开始),end = **git 空树**(回合结束时 a.md 已被外部删除)。`GET /api/session/{B}/diff` 不带参数响应原文:

```json
{"data":[{"file":"a.md","patch":"diff --git a/a.md b/a.md\ndeleted file mode 100644\nindex 6d72975..0000000\n--- a/a.md\n+++ /dev/null\n@@ -1,4 +0,0 @@\n-hello\n-world\n-foo\n-bar\n","additions":0,"deletions":4,"status":"deleted"}]}
```

EXTVIEW 重放:`attribution=["a.md"] rawRows=["deleted a.md +0 -4"] keptAfterFilter=["deleted a.md +0 -4"]` ——与用户报告的 Bug 1a 行**逐字一致**(`deleted a.md +0 -4`),且**穿过严格过滤**。

### 待证 2:归因窗口是什么?——**单条 assistant 消息自带的 [start,end] 快照对**(≈回合起点→该消息完成),非会话累积、非跨会话累积

- **不是会话累积**:exp3 里 B 先后三个纯聊天回合,B1/B2/B3 各自消息的 `files` 都只反映**自己窗口内**的变化;A 在 B 两个回合**之间**重建 a.md(B3 前)、外部在回合间删除 a.md(B2 前),都没有进后续回合的 `files`。窗口开始时的树就是基线:外部改动发生在**回合开始之前** → 看不见(exp3 B2:`snapshot:{start:"f65fe7e9…",end:"f65fe7e9…","files":[]}`,两 ID 相同)。
- **不是跨会话共享链**:每个回合各取自己的快照对(B1 的 start/end 与 A1 的 end 同为 f65fe7e9 只是树内容恰好相同的哈希碰撞式复用,不是链引用)。
- **回合内多消息各带各的窗口**:A1 一个回合有两条 assistant 消息,tool-calls 那条带 `files:["a.md"]`(窗口从空树到含 a.md),收尾文本那条 `files:[]`。扩展 `attributionSet` 取并集,正确覆盖。
- **多回合区间 diff 是另一个泄露面**:把区间拉成 `from=B 首个 user message & to=B 最新 user message` 时,服务器"拿区间首末快照对拍",**跨回合的外部改动会进 raw diff**——exp3 B2(外部删除在 B1 与 B2 之间):`GET /api/session/{B}/diff?from=msg_…Y60Z&to=msg_…lGt6` 响应含 `"status":"deleted","file":"a.md","additions":0,"deletions":4`,而此时 B 的 attribution=[] → 严格过滤丢掉 → 0.4.21+ 列表为空(ADR-0008 语义实测成立;0.4.21 之前的 passthrough 就是这么把行灌进 B 的)。

### 待证 3:B 行的实际状态与 +/− 计数——**`deleted a.md +0 -4`,亲见**

上节 exp3 phase 3 的 diff 响应原文即钉死:status=`deleted`,additions=0,deletions=4(实验文件恰好 4 行,与当初报告形态相同)。concurrent-create 方向(exp4)对应形态为 `modified a.md +1 -1`(patch 原文:`@@ -1 +1 @@\n-base\n+changed-by-A-during-B`)。排错期用户"按预期给出的回答"现在有了服务器亲见版本。

### 待证 4:subagent 子会话的改动是否归入父会话?——**否(本次运行)**;子会话自己归因,父会话 raw 区间 diff 在**下一个 user 回合**才会泄出该文件,但被严格过滤挡住

父会话 P prompt 其 spawn subagent(agent:general)写 `sub.md`。时序:父回合 idle 1795018795436,子的 write 消息 completed 1795018795591 ——**子的写落在父回合窗口关闭之后**。结果:

- **子会话 C** 的 write 消息(实测原文):`snapshot:{start:"48e718dd…",end:"4fec52b2…","files":["sub.md"]}`,tools=[{name:"write",status:"completed",path:"…/sub.md"}];`GET /api/session/{C}/diff` → `added sub.md +1 -0`。子会话归因正确。
- **父会话 P** 三条 assistant 消息 `files` 全为 `[]`(含 `<subagent>` report 唤醒后新增的一条:`snapshot:{start:"4fec52b2…",end:"4fec52b2…","files":[]}`,该窗口开启时 sub.md 已存在,无差量)。`GET /api/session/{P}/diff` 不带参数 → `[]`。**父会话的 attribution 从未包含 sub.md。**
- 子会话完工报告以 **`type:"synthetic"`** 消息进父会话(`metadata.source="subagent"`);diff 端点对 `to` 传非 user 消息直接报错:{"_tag":"InvalidRequestError","message":"Message msg_… is not a user message","field":"to"} ——扩展按 user 消息取区间,天然停在原有回合,**区间无法跨进子的写入**。
- 但 P 上再发一个新 user 回合后,`?from=P首个user&to=P最新user` 的 raw 区间 diff 变成 `added sub.md +1 -0`(原文已存)——raw 泄露存在,而 P 的 attribution 仍=[] → 严格过滤丢弃 → 0.4.21+ 父列表不显示(0.4.20 passthrough 时代会显示)。
- 边界注记:父/子窗口的相对时序是**竞态而非设计**——若子的写落在父回合某消息窗口开启之后、关闭之前,按本实证的窗口机制(会话无关),父会话同样会把子的文件吸进自己的 attribution。待证 4 的"否"是本运行的事实,不是结构性保证。

### 未阻塞项与残留不确定性

- 四条待证全部实证,无 blocked。
- 局限:单一 server 版本(v2.3.0)、单一模型、实验室空仓(git init、无 .gitignore 干扰)。真实项目里 snapshot 语义(空树/树哈希)以 git 为基这一点未逐项验证,但窗口机制与会话无关性由两条独立方向(他_session 写入 / 无会话删除)交叉证实。
- 复现时序敏感:exp3 首次并发写测试(B3)因 A3 回合实际在 B3 结束后 66ms 才开始而**未重叠**(`files:[]`,对照组价值:窗口关闭后不归因);exp4 用"先发 A、800ms 后发 B"才保证重叠。证伪/证实都要核对事件时间线,不能只看并发意图。

### 对扩展的实践结论

1. **归因过滤需要加固**(spec 验收点名的方向成立):`snapshot.files` 单独不可信。把 `attributionSet` 与**本会话自己回合内的 write/edit 类 tool 输入路径**交叉验证:被归因、但从未出现在本会话任何写类工具输入里的文件,视为窗口噪音丢弃。B4/B5 两条 ghost 行的泄漏消息 `"tools":[]`,交叉验证后必然为空集、行被丢;A1/A6 的真实写入行有 write 工具路径,保留。消息已在扩展抓取范围内(`AssistantContent` tool part 的 `state.input`),不需要新端点。代价与 ADR-0008 "Alternatives rejected" 里记录的一致:shell 重定向写的文件会被漏掉(假阴性)——以"漏行"换"串行",方向值得翻转,ADR-0008 该条与 GLOSSARY「Attribution set」词条需要修订。
2. **严格空归因→空列表(ADR-0008)实测有效**:sequential 场景(B2-range-allturns 泄 `deleted a.md +0 -4`、attribution=[])被正确挡住;泄漏面只剩"他人改动落进本会话回合窗口"这一种,即第 1 点。
3. subagent 场景无需改:子的文件归子的,父列表在严格过滤下不串;但父会话 raw 区间 diff 会泄,如未来有人把过滤改松,这里是下一个串行点。
4. 服务端侧的记录性修正:`session.idle` 在 2.3.0 不发(回合结束 = `session.execution.*`);message 列表新→旧;`to` 只接受 user 消息。均已记入本票,供后续排错引用。
