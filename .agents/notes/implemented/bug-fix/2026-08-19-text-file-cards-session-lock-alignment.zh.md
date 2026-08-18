# Agent Note: 文本文件暂存镜像 composer 的会话级锁

Status: implemented

[English](2026-08-19-text-file-cards-session-lock-alignment.md) | 中文

## Problem

text-file-cards fork 扩展在捕获阶段接管 document 级 `drop` 事件,把纯文本批次暂存为卡片,并经公共 `ctx.conversation.input` 服务把卡片内容展开进草稿。它的守卫检查了输入状态机(`adjudicating`/`submitting` 拒绝)与 composer 可见性,却没有检查 composer 自身渲染为只读的会话级条件:会话被移除,以及可续接 subagent 子会话的精确父会话离线。在这些状态下 composer 拒绝一切编辑,而插件的展开路径仍经 input 服务把内容写进草稿——服务层自身没有锁——拖拽暂存也继续接收永远无法展开为可用消息的文件。该插件在机器锁一轴上比 composer 严格,在会话锁一轴上却更宽松。

## Decision

暂存与展开在插件可观测的范围内镜像 composer 的禁用谓词。`sessionAcceptsEdits(ctx, actx)` 读取 `ctx.sessions.sessionOf(actx).getSnapshot()`,要求会话 face 可解析、`removed` 为假,且——当快照携带 subagent 时——地址模式非 continuable 或 `parentAvailable` 为真。两个调用点:`resolveEditableInput`(drop 接管入口)在暂存前拒绝锁定的会话,drop 因此落回 composer 原生的整文件 intake;expand 回调在异步 `file.text()` 读取前各检查一次、读取后再检查一次,因为读取文件期间可能开始提交或翻转锁。composer 其余的锁原因是属主 prop 事实、没有公共信号——无工作区的 inert hero 没有当前会话(既有当前会话守卫已覆盖),属主阻断(如缺少模型选择)是 composer 内部状态——因此属主阻断期间暂存与展开刻意保持可用,展开后的草稿在用户解除阻断前不会被提交。

## Verification

三个在真实 cordis Context bench 上的包测试:移除会话上的 drop 不被 prevent 且什么都不暂存;可续接子会话的父会话离线时行为相同;暂存后会话翻转为 removed 的 expand 不调用 `setDraft` 并保留暂存卡片。双语 README 的守卫列表、暂存模型小节与已知限制条目写明对齐后的条件与不可观测的属主 prop 缺口。

## Alternatives considered

**只检查展开,暂存照旧。** drop 仍被接管吞掉,原生 intake 永远看不到它;暂存卡片也会活得比一个永远无法接受它的会话更久。在两个入口都拒绝才是与 composer 一致的行为。

**从 runtime 暴露单一 `composerLocked` 信号。** 这会把 composer 的禁用谓词提升为公共服务——恰是 fork 刻意不碰的核心 Web UI 领域——而且它包含的属主 prop 原因本就没有信号可暴露。可观测子集恰好由既有会话快照的 `removed` 与 `subagent.parentAvailable` 组合而成。

**锁定期仍暂存但禁用展开按钮。** 这制造一张可见却永久不可用的卡片,还吞掉了原生 intake 本可处理的 drop;直接放行事件更简单,也与既有"整批放行保住图片第一方路径"的规则一致。

## Consequences

锁定会话上的 drop 现在落回 composer 原生 intake,不再产生无法展开的卡片;与锁翻转竞争的 expand 会被放弃并保留卡片以供后续。属主阻断期间插件仍可用:内容能进草稿但在阻断解除前不能提交——记录为已知限制而非修复,因为 fork 不伸入 composer。测试 bench 在 `sessions.sessionOf` 之后新增了可变的会话快照 fake,未来的锁条件测试可以用同样方式翻转它。
