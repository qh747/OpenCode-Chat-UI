# 0012 — Diff list 的信任边界:不信服务器历史,面板记忆层自持

日期:2026-11-18
状态:已接受

## 背景

Diff list 的行来自 `GET /api/session/{id}/diff` 的区间 diff,反映的是**不可变的消息快照历史**。扩展的 Revert 是扩展侧写盘(added → 删除进回收站;deleted → 重建目录写回 before 内容;modified → 写回 before 内容,见 `.scratch/diff-visibility/spec.md`),服务器历史对此不知情:刷新后端点原样吐回已被撤销的行。归因过滤(ADR-0008)救不了——被撤销文件本就合法地在创建它的会话的归因集里。撤销过的行因此会「复活」,除非面板自己记得它们已被处理。

## 决策

列表的信任边界:**不信服务器历史对「未处理」的表态,由面板记忆层自持**:

1. **已处理签名(按会话 park)**:Revert 成功即按「文件 + 改动签名(`status:additions:deletions`)」记录;任何刷新、会话切换、新回合都不再吐出签名匹配的行;只有本会话 agent 再次改动该文件(签名变化)才重现。记忆按会话作用域,切换存取而非清除。
2. **added 行磁盘真相**:`status=added` 且文件已不在盘上的行永不显示——无事可做,与「列表 = 本会话 agent 的待处理改动」的词条语义自洽。`deleted` 行不适用(文件不在盘上恰是其待处理常态,恢复它才是待办);`modified` 不做廉价内容校验。
3. **送达与显示解耦**(同批,队列腿):队列状态按会话键存,排水一律以所属会话为目标,后台回合结束同样送达所属会话——显示只是视口,不是状态的所有者(统一原则见 `session-switch-leaks` spec)。

## 备选与取舍

- **改用服务器的消息回滚式 revert**(/undo / rewind):语义完全不同——回滚消息与文件,不是「只回滚这一个文件」;会丢掉「Revert 是面板独有的单文件回滚」能力。否决。
- **已处理签名持久化到 workspaceState**:单独给 Revert 持久化与既有内存语义(Keep 时代)不对称;若做应连全部处理语义一起,暂不做,窗口重载后 modified/deleted 已撤销行可复活为已知局限(added 行被磁盘真相压住)。
- **全局串行化 handleMessage**:键控化后按会话解析归属,竞态结构性消失,无需串行化(`session-switch-leaks` 分支 4 Q10 的缓决由此关闭)。

## 后果

- 「待处理改动」语义在扩展侧闭环,不依赖服务器对扩展侧写盘的感知;列表与磁盘状态对 added 行永不离谱(盘上没有就不显示)。
- 服务器 `snapshot.files` 归因被写宽的形态已由 `.scratch/server-snapshot-attribution/` 调查定案,并经 ADR-0008 两级修订收窄(per-message credibility → per-file tool-input cross-check);本 ADR 的磁盘真相兜底(added 形态)仍保留为收窄之后的最后防线。
