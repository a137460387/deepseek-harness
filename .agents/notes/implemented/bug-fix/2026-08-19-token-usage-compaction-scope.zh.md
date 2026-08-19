# Agent Note: tokenUsage 计入压缩摘要调用的用量

Status: implemented

[English](2026-08-19-token-usage-compaction-scope.md) | 中文

## Problem

`compaction/summary` 会话事件在携带影子价格的同时，还携带摘要调用自身的提供方用量（`provider`、`model`、`usage?`），但 `tokenUsage` 投影只折叠 `assistant/chunk`(usage) 与 `assistant/message` 两种样本。于是每次摘要调用的 token 都从会话的持久用量总量中消失——Web 状态条（输入/输出/缓存命中）与 subagent 目录的 token 总量恰好对发生过压缩的会话少计，而完整数据一直躺在投影所重放的日志里。

## Decision

[`packages/llm/token-meter/src/usage-projection.ts`](../../../../packages/llm/token-meter/src/usage-projection.ts) 的 `tokenUsageProjectionDefinition.apply` 增加了 `compaction/summary` 分支：事件携带 `usage` 时，四个桶通过 `addReplacing(totals, undefined, buckets)` 全额累加；`usage` 缺省（模板或远程摘要器未上报）时该事件是 no-op，返回同一 state 引用，change feed 保持静默。摘要用量从不触碰 `last` 样本槽——事件不带 turn/step，(turn, step) 替换逻辑保持原样。

`stateVersion` 由 1 提升到 2。已持久化的 projection-cache 中 ver 为 1 的行在读取时被丢弃并从日志重放（缓存既定的「丢弃而非迁移」路径），冷会话因此无需迁移步骤即收敛到扩大后的口径。

包 README（双语）现在把口径表述为主循环请求加压缩摘要调用，并在已知限制中记录无 usage 摘要器与 session-title-llm 两个缺口；同时修正了「压缩自身不追加任何用量」这句写于 `compaction/summary` 尚无 usage 字段时期的过时表述——现在它准确说明用量记录在这个仅写日志的事件上，处于 `pressureTokens` 所取样的请求路径之外。Web fixture 的 `tokenUsageOf` 镜像了该分支，`projectionFramesOf` 对携带 usage 的摘要推送 `tokenUsage` 帧（绝不推 `contextPressure`——该单元只从请求路径取样）。

## Alternatives considered

**独立的投影键（如 `compactionUsage`）。** 现有消费方（StatsLine、SubagentCatalogAction）都把 `tokenUsage` 读作会话总量，拆键意味着每个消费方都要多一次读取再加法，而「这个会话花了多少 token」本就是一个事实。单一键让总量只有一个家；折叠分支只有四行。

**让消费方自己扫描 `compaction/summary`。** 同一段累加逻辑会被复制进每个客户端，且推送帧与持久化 checkpoint 快路径都带不上合并后的数字。

**把摘要塞进 (turn, step) 替换逻辑。** 该事件不属于任何 step；编造坐标会破坏 `last` 槽依赖的相邻性不变量，并可能在重放时重复计数。

## Consequences

会话用量总量会因每次上报了 usage 的摘要调用而变大——这是预期修正，不是回归。已发布快照无变化：fixture 日志与 seeded-history 场景都不含带 `usage` 的 `compaction/summary`，落地前已核实。对于旧 checkpoint 早于版本号提升的会话，总量在重启后不再单调：被丢弃的 ver-1 行重放出更大的值，这是口径变更生效，不是漂移。`session-title-llm` 仍不记录用量；其调用始终处于所有用量 fold 之外，该缺口作为暂缓事项记录在 README 的已知限制中。
