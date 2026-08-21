# Agent Note: fork Web UI 输入扩展以自包含插件落位 extensions/

Status: implemented

[English](2026-08-19-fork-ui-extensions-placement.md) | 中文

## Problem

fork 需要 upstream 没有的 Web UI 输入行为:全页粘贴路由(global-paste)与文本文件拖拽暂存卡片(text-file-cards)。FORK_NOTES.md 禁止改动官方核心或包私有文件(composer 自身的图片 intake、InputBar 私有的输入状态机 face),两者都必须走官方插件缝隙——但包落在哪里当时没有留下决策:`packages/client/` 是 upstream 持有并持续演进的 Web GUI 浏览器半,新建 `fork-extensions/` 组也从未被权衡。同时 `extensions/` 组 README 只把组描述为运行时自修改,六个包中有两个不在其章程与包表里,且没有任何 Agent Note 记录这两个包的引入设计(粘贴路由架构与图片转发机制首当其冲)。

## Decision

fork Web UI 扩展是 `packages/extensions/` 下自包含的浏览器半插件包,只经官方缝隙可达:

- **global-paste**(`@deepseek-ai/dsh-client-global-paste`):一个 document 级捕获阶段 `paste` 监听器。文本经公开 `ctx.conversation.input` 服务(`setDraft`)追加;图片通过向 composer textarea 重新派发携带 `DataTransfer`(内含 file 项)的合成 `ClipboardEvent` 转发,让 composer 自身的 `onPaste` 跑完整的官方图片 intake——复制包私有的 `browserDraftAttachment` 路径会违反 FORK_NOTES.md。混合粘贴拆分:文本走服务,图片走转发。
- **text-file-cards**(`@deepseek-ai/dsh-client-text-file-cards`):一个 document 级捕获阶段 `drop` 监听器接管纯文本批次,以会话 id 为键把 `File` 对象整体暂存在快照 store 中,经官方 `conversation.input.dock` slot 渲染卡片;展开卡片走公开 input 服务。图片与混合批次放行给 composer 原生 intake。
- 两者各带 `./invariant` 伴生件保留包名所有权,不进入 host 聚合,并镜像 composer 的会话级锁(见[锁镜像 Agent Note](../bug-fix/2026-08-19-fork-ui-composer-lock-mirroring.zh.md))。

落位:`extensions/` 而非 `packages/client/`。该组章程就是产品 spine 之外的能力——已有浏览器半包(`cordis-client-runner`、`ui-cordis`)且被 host 聚合排除——fork 浏览器插件放这里无需新开组,upstream 的 `client/` 包也免于在其组 README 与引用中混入 fork 行,合并面收敛到本组 README 一处。

## Alternatives considered

**放进 `packages/client/`。** 它们确实是浏览器插件,但 `client/` 由 upstream 持有并持续演进;fork 行进入其组 README、聚合与清单都会变成反复出现的合并冲突面。`extensions/` 把这个面收敛到一个 README 包表。

**开专门的 `fork-extensions/` 组。** 按来源开组增加导航成本,还制造第二个找浏览器插件的地方;`extensions/` 章程本就覆盖 spine 之外的能力包,不论作者是谁。

**经 `patches/` 补丁官方 composer。** FORK_NOTES.md 把补丁排在插件缝隙实现之后,且任何核心触碰都要求显式确认;两种行为都能经公开服务与 slot 达成,无需补丁。

## Consequences

`git merge upstream/master` 触及 fork UI 扩展的只有 `extensions/` 组 README 包表,不会碰 `client/` 组文件。任一 fork 包删除时只需移除其目录、`cordis.patch.yml` 行与清单引用。组 README 现在承载全部六个包并标注 fork 行,关闭章程缺口;FORK_NOTES.md 记录落位规则,后续 fork 扩展默认落此。
