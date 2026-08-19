# Agent Note: 使用统计——fork 投影加设置页

Status: implemented

[English](2026-08-19-usage-stats-settings-tab.md) | 中文

## Problem

Web UI 只展示单会话 token 总量（状态条、subagent 目录），回答不了「这套部署按提供方/模型、按天、按月各消耗了多少」：`tokenUsage` 是每个会话一个不拆分的整体，没有任何投影携带路由或时间维度，也没有任何东西做跨会话聚合。fork 需要这个跨会话视图，同时不碰 `packages/client/` 下的任何共享文件。

## Decision

双面 fork 包 [`packages/extensions/usage-stats/`](../../../../packages/extensions/usage-stats/README.md)（`@deepseek-ai/dsh-client-usage-stats`）：

- **Node 半边**在 `ctx.sessionProjections` 上注册 `usageStats` 会话投影单元（`dsh-session-stats` 形态）。折叠与 `tokenUsage` 口径完全一致——带 `(turn, step)` 替换语义的分片样本、压缩摘要用量全额累加——但按 UTC 刻钟与路由分桶。路由归属读最近的 `request/header` 的 provider/model；摘要自带路由；头事件之前的用量（实践中不合法）落 `unknown` 路由。归零的槽位被修剪，无活动会话折叠为 `{ quarters: {} }`。
- **递送走标准投影机制**——`session/projection` 实时帧、持久化投影缓存、会话列表基线——本包不拥有任何通道。
- **浏览器半边**通过 `settings.section` 插槽注册设置页（id `usage-stats`，order 25 排在 Agent 预设之后，默认齿轮图标）。控制器从列表基线读取每个会话的值，并对基线早于本单元的会话经 history 尾页补洞——该页的 `projections` 块用全部已注册单元折叠整条日志；连那里也缺键则计入精确的「主机组合缺本单元」提示。

桶是**刻钟**（15 分钟）而非小时：任何 IANA 时区偏移——:00、:15、:30、:45——都落在刻钟边界上，浏览器因此能把桶精确重组为查看者的本地日与月（含 `Asia/Kolkata` 这类半时区偏移）；全部日历换算在客户端，主机不感知时区。页面渲染顶部卡片（累计、单日峰值、当前与最长连续）、GitHub 风格活动日历（每日/每周/累计三种着色）、按范围的多序列趋势图、路由占比环形图——只统计 token 数量，永不折算价格。

接线走 fork 既定追加面：`cordis.patch.yml` 一行 row、web-app `package.json` 一条依赖、两个根 tsconfig 聚合各一条引用（包按 `api/gateway` 的方式拆 `tsconfig.host.json`/`tsconfig.client.json`，因为 node 半边携带 client 半边不得引入的 host 侧导入）、extensions 组 README 一行、`verify-package-readme-model-experience` 一条审计条目。未改任何 `packages/client/` 文件。

## Development findings

开发过程中发现并修复了两个真实缺陷，均在同一改动内落地：

- **修剪路径丢失了删空的刻钟。** `applyBucketDelta` 的删除分支最初写作 `omitKey(quarters, key) ?? quarters`——空记录（删键后什么都不剩）返回 `undefined`，`??` 便把删除前的对象原样还原，该刻钟保留了本应被替换移除的值。`(turn, step)` 替换测试抓到了它（分片样本后跟一个不同的最终用量，两笔都被计入）；修复区分「删空」（`{}`）与「键不存在」（`undefined`）。教训可以泛化：对一个合法返回「空」的函数用 `??` 兜底，就是一个静默失败席位。
- **图表滚动容器骑在基础表面滚动条上。** 热力图与趋势图包装层设了 `overflow-x: auto` 却落在卡片海拔面上（`--dsw-alias-bg-layer-3`）；`scrollbar-styles.client.spec.ts` 要求所有 elevated 滚动容器把 `--dsh-scrollbar-thumb`/`--dsh-scrollbar-thumb-hover` rebind 到 l2 对。修复是在 `UsageStatsSection.module.css` 里 rebind 这两个间接层——抓到它的是契约测试而非人工审查。

## Alternatives considered

**纯浏览器聚合原始 `session.history` 页。** 每一页都会为了投影 O(1) 状态就能算出的数字而传输工具输出量级的事件；首次打开会卡在线上。投影把线上载荷收敛为每会话一个值。

**host 侧 TypertRemoteService 自有命名空间。** 服务端跨会话聚合需要 api-remotes 挂载、生成 `/remote` 工件、每个问题一个新端点；投影路径通过已存在、已持久化 checkpoint 的递送机制到达浏览器。

**直接扩展 `tokenUsage` 加路由/时间键。** 一个单元同时伺服状态条和统计页，会迫使状态条的消费方绕读新维度，且两个折叠的同一性语义不同（末样本替换 vs 刻钟分桶）。独立键让 `tokenUsage` 与其消费方原封不动。

**小时桶。** 半时区偏移会骑跨小时边界，迫使主机了解每个查看者的时区才能正确切分。刻钟桶让一切偏移都精确，时区问题完全留在客户端。

## Consequences

设置弹窗新增第五个导航行（「使用统计」），渲染主机列出的全部会话的数字，包括插件存在之前记录的会话（history 尾页补洞，串行——插件启用前历史越多首次打开越慢）。环形图是全历史口径（范围选择器只作用于趋势图）；活动日历最多 53 周，所有顶部数字仍计全历史；页面停留期间新增的用量在下次刷新出现。计数继承 `tokenUsage` 口径，辅助标题生成（`session-title-llm`）仍不计入——与五色相图表色板一起记录在包 README 的已知限制中。

这是首个带真实 node half 的 fork 扩展：落位规则的「不进 host 聚合」措辞从此意为「host 聚合引用包的 host 面」而非「没有 host 代码」，FORK_NOTES 已记录。
